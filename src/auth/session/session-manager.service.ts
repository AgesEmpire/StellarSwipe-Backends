import { Injectable, Logger, Inject, UnauthorizedException } from '@nestjs/common';
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
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
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
    this.sessionTTL = this.configService.get('auth.sessionTTL', 3600);       // 1 h access
    this.refreshTTL = this.configService.get('auth.refreshTTL', 604800);     // 7 d refresh
    this.maxSessionsPerUser = this.configService.get('auth.maxSessionsPerUser', 5);

    // Derive a 32-byte AES-256 key from the JWT secret so no extra config is needed
    const secret = this.configService.get<string>('jwt.secret', 'change-this-secret-key');
    this.encryptionKey = crypto.createHash('sha256').update(secret).digest();
  }

  // ── Token issuance ────────────────────────────────────────────────────────

  /**
   * Issue an access + refresh token pair and persist the session.
   * The refresh token is stored encrypted at rest.
   */
  async issueTokens(
    userId: string,
    publicKey: string,
    metadata?: Record<string, any>,
  ): Promise<TokenPair> {
    const sessionId = crypto.randomUUID();
    const refreshToken = crypto.randomBytes(40).toString('hex');

    const accessToken = this.jwtService.sign(
      { sub: userId, sid: sessionId },
      { expiresIn: this.sessionTTL },
    );

    await this.createSession(sessionId, userId, publicKey, metadata);
    await this.storeRefreshToken(refreshToken, sessionId, userId);

    return { accessToken, refreshToken, expiresIn: this.sessionTTL };
  }

  /**
   * Rotate tokens: validate the refresh token, revoke the old session,
   * and issue a fresh pair.
   */
  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    const payload = await this.consumeRefreshToken(refreshToken);
    const session = await this.getSession(payload.sessionId);
    if (!session) throw new UnauthorizedException('Session not found or expired');

    // Revoke old session before issuing new one (token rotation)
    await this.deleteSession(payload.sessionId);

    return this.issueTokens(session.userId, session.publicKey, session.metadata);
  }

  // ── Session CRUD ─────────────────────────────────────────────────────────

  async createSession(
    sessionId: string,
    userId: string,
    publicKey: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const now = Date.now();
    const sessionData: SessionData = { userId, publicKey, createdAt: now, lastActivity: now, metadata };

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

  /** Revoke all sessions for a user (logout everywhere / suspicious activity). */
  async deleteAllUserSessions(userId: string): Promise<void> {
    const sessions = await this.getUserSessions(userId);
    await Promise.all(sessions.map((id) => this.cacheManager.del(`session:${id}`)));
    await this.cacheManager.del(`user_sessions:${userId}`);
    this.logger.log(`All sessions revoked for user ${userId}`);
  }

  async getUserSessions(userId: string): Promise<string[]> {
    const raw = await this.cacheManager.get<string>(`user_sessions:${userId}`);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  async getActiveSessionCount(): Promise<number> {
    return 0; // Redis SCAN required for accurate count in production
  }

  // ── Refresh token helpers ─────────────────────────────────────────────────

  private async storeRefreshToken(
    token: string,
    sessionId: string,
    userId: string,
  ): Promise<void> {
    const payload = JSON.stringify({ sessionId, userId });
    await this.cacheManager.set(
      `refresh:${token}`,
      this.encrypt(payload),
      this.refreshTTL * 1000,
    );
  }

  private async consumeRefreshToken(
    token: string,
  ): Promise<{ sessionId: string; userId: string }> {
    const raw = await this.cacheManager.get<string>(`refresh:${token}`);
    if (!raw) throw new UnauthorizedException('Invalid or expired refresh token');

    // One-time use: delete immediately
    await this.cacheManager.del(`refresh:${token}`);

    try {
      return JSON.parse(this.decrypt(raw));
    } catch {
      throw new UnauthorizedException('Malformed refresh token');
    }
  }

  // ── Encryption helpers (AES-256-GCM) ─────────────────────────────────────

  private encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  private decrypt(ciphertext: string): string {
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async addUserSession(userId: string, sessionId: string): Promise<void> {
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

  private async removeUserSession(userId: string, sessionId: string): Promise<void> {
    const sessions = (await this.getUserSessions(userId)).filter((id) => id !== sessionId);
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
