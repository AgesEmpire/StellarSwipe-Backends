import {
  Injectable,
  Logger,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';

export interface SessionData {
  userId: string;
  publicKey: string;
  createdAt: number;
  lastActivity: number;
  metadata?: Record<string, any>;
  /** Token family ID for refresh-token reuse detection (issue #1011). */
  familyId?: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface RefreshRecord {
  sessionId: string;
  userId: string;
  familyId: string;
  /** true once the token has been successfully rotated */
  consumed: boolean;
  /** hash of the successor token (if already rotated) */
  nextTokenHash?: string;
}

@Injectable()
export class SessionManagerService {
  private readonly logger = new Logger(SessionManagerService.name);
  private readonly sessionTTL: number;
  private readonly refreshTTL: number;
  private readonly maxSessionsPerUser: number;
  private readonly encryptionKey: Buffer;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private configService: ConfigService,
    private jwtService: JwtService,
  ) {
    this.sessionTTL = this.configService.get('auth.sessionTTL', 3600);
    this.refreshTTL = this.configService.get('auth.refreshTTL', 604800);
    this.maxSessionsPerUser = this.configService.get(
      'auth.maxSessionsPerUser',
      5,
    );

    const secret = this.configService.get<string>(
      'jwt.secret',
      'change-this-secret-key',
    );
    this.encryptionKey = crypto.createHash('sha256').update(secret).digest();
  }

  /** Hash a refresh token for storage (issue #1011). */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  }

  // ── Token issuance ────────────────────────────────────────────────────────

  async issueTokens(
    userId: string,
    publicKey: string,
    metadata?: Record<string, any>,
    familyId?: string,
  ): Promise<TokenPair> {
    const sessionId = crypto.randomUUID();
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const resolvedFamily = familyId ?? crypto.randomUUID();

    const accessToken = this.jwtService.sign(
      { sub: userId, sid: sessionId },
      { expiresIn: this.sessionTTL },
    );

    await this.createSession(sessionId, userId, publicKey, {
      ...metadata,
      familyId: resolvedFamily,
    });
    await this.storeRefreshToken(refreshToken, sessionId, userId, resolvedFamily);

    return { accessToken, refreshToken, expiresIn: this.sessionTTL };
  }

  /**
   * Rotate tokens with reuse detection (issue #1011).
   *
   * - Valid unused token → mark consumed, issue new pair in same family
   * - Already-consumed token (replay) → revoke entire family, reject
   */
  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    const tokenHash = this.hashToken(refreshToken);
    const key = `refresh:${tokenHash}`;
    const raw = await this.cacheManager.get<string>(key);

    if (!raw) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    let record: RefreshRecord;
    try {
      record = JSON.parse(this.decrypt(raw)) as RefreshRecord;
    } catch {
      throw new UnauthorizedException('Malformed refresh token');
    }

    // Reuse detection: token already consumed → compromise
    if (record.consumed) {
      this.logger.warn(
        `Refresh-token reuse detected for family=${record.familyId} user=${record.userId} — revoking family`,
      );
      await this.revokeFamily(record.familyId, record.userId);
      throw new UnauthorizedException(
        'Refresh token reuse detected; all sessions in this family have been revoked',
      );
    }

    const session = await this.getSession(record.sessionId);
    if (!session) {
      throw new UnauthorizedException('Session not found or expired');
    }

    // Mark current token as consumed (keep record briefly so reuse can be detected)
    record.consumed = true;
    await this.cacheManager.set(
      key,
      this.encrypt(JSON.stringify(record)),
      Math.min(this.refreshTTL * 1000, 60 * 60 * 1000), // keep at least 1h for reuse detection
    );

    // Revoke old session, issue new pair in the same family
    await this.deleteSession(record.sessionId);
    const pair = await this.issueTokens(
      session.userId,
      session.publicKey,
      session.metadata,
      record.familyId,
    );

    // Link successor hash on the consumed record (optional forensics)
    record.nextTokenHash = this.hashToken(pair.refreshToken);
    await this.cacheManager.set(
      key,
      this.encrypt(JSON.stringify(record)),
      Math.min(this.refreshTTL * 1000, 60 * 60 * 1000),
    );

    return pair;
  }

  /**
   * Revoke every session that belongs to a compromised token family.
   */
  private async revokeFamily(familyId: string, userId: string): Promise<void> {
    const sessions = await this.getUserSessions(userId);
    for (const sid of sessions) {
      const s = await this.getSession(sid);
      if (s?.familyId === familyId || s?.metadata?.familyId === familyId) {
        await this.deleteSession(sid);
      }
    }
    // Best-effort: clear family marker
    await this.cacheManager.del(`family:${familyId}`);
    this.logger.warn(
      `Token family ${familyId} revoked for user ${userId} due to refresh-token reuse`,
    );
  }

  // ── Session CRUD ─────────────────────────────────────────────────────────

  async createSession(
    sessionId: string,
    userId: string,
    publicKey: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const now = Date.now();
    const sessionData: SessionData = {
      userId,
      publicKey,
      createdAt: now,
      lastActivity: now,
      metadata,
      familyId: metadata?.familyId,
    };

    await this.cacheManager.set(
      `session:${sessionId}`,
      this.encrypt(JSON.stringify(sessionData)),
      this.sessionTTL * 1000,
    );

    await this.addUserSession(userId, sessionId);
    this.logger.log(`Session created for user ${userId}: ${sessionId}`);
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    const raw = await this.cacheManager.get<string>(`session:${sessionId}`);
    if (!raw) return null;
    try {
      return JSON.parse(this.decrypt(raw)) as SessionData;
    } catch {
      this.logger.error(`Failed to decrypt session ${sessionId}`);
      return null;
    }
  }

  async updateSessionActivity(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;
    session.lastActivity = Date.now();
    await this.cacheManager.set(
      `session:${sessionId}`,
      this.encrypt(JSON.stringify(session)),
      this.sessionTTL * 1000,
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session) await this.removeUserSession(session.userId, sessionId);
    await this.cacheManager.del(`session:${sessionId}`);
    this.logger.log(`Session revoked: ${sessionId}`);
  }

  async deleteAllUserSessions(userId: string): Promise<void> {
    const sessions = await this.getUserSessions(userId);
    await Promise.all(
      sessions.map((id) => this.cacheManager.del(`session:${id}`)),
    );
    await this.cacheManager.del(`user_sessions:${userId}`);
    this.logger.log(`All sessions revoked for user ${userId}`);
  }

  async getUserSessions(userId: string): Promise<string[]> {
    const raw = await this.cacheManager.get<string>(`user_sessions:${userId}`);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async getActiveSessionCount(): Promise<number> {
    return 0;
  }

  // ── Refresh token helpers ─────────────────────────────────────────────────

  private async storeRefreshToken(
    token: string,
    sessionId: string,
    userId: string,
    familyId: string,
  ): Promise<void> {
    const tokenHash = this.hashToken(token);
    const record: RefreshRecord = {
      sessionId,
      userId,
      familyId,
      consumed: false,
    };
    await this.cacheManager.set(
      `refresh:${tokenHash}`,
      this.encrypt(JSON.stringify(record)),
      this.refreshTTL * 1000,
    );
  }

  // ── Encryption helpers (AES-256-GCM) ─────────────────────────────────────

  private encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  private decrypt(ciphertext: string): string {
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      iv,
    );
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async addUserSession(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const sessions = await this.getUserSessions(userId);
    if (sessions.length >= this.maxSessionsPerUser) {
      const oldest = sessions.shift()!;
      await this.cacheManager.del(`session:${oldest}`);
      this.logger.log(`Evicted oldest session for user ${userId}: ${oldest}`);
    }
    sessions.push(sessionId);
    await this.cacheManager.set(
      `user_sessions:${userId}`,
      JSON.stringify(sessions),
      this.refreshTTL * 1000,
    );
  }

  private async removeUserSession(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const sessions = (await this.getUserSessions(userId)).filter(
      (id) => id !== sessionId,
    );
    if (sessions.length > 0) {
      await this.cacheManager.set(
        `user_sessions:${userId}`,
        JSON.stringify(sessions),
        this.refreshTTL * 1000,
      );
    } else {
      await this.cacheManager.del(`user_sessions:${userId}`);
    }
  }
}
