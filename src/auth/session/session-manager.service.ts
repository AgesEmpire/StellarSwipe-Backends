import {
  Injectable,
  Logger,
  Inject,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
  familyId?: string;
  refreshTokenHash?: string;
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
  private readonly cacheTimeoutMs: number;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private configService: ConfigService,
    private jwtService: JwtService,
    @Optional() private readonly events?: EventEmitter2,
  ) {
    this.sessionTTL = this.configService.get('auth.sessionTTL', 3600); // 1 h access
    this.refreshTTL = this.configService.get('auth.refreshTTL', 604800); // 7 d refresh
    this.maxSessionsPerUser = this.configService.get(
      'auth.maxSessionsPerUser',
      5,
    );
    this.cacheTimeoutMs = this.configService.get<number>('redisCache.operationTimeoutMs', 500);

    // Derive a 32-byte AES-256 key from the JWT secret so no extra config is needed
    const secret = this.configService.get<string>(
      'jwt.secret',
      'change-this-secret-key',
    );
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
    familyId: string = crypto.randomUUID(),
  ): Promise<TokenPair> {
    const sessionId = crypto.randomUUID();
    const refreshToken = crypto.randomBytes(40).toString('hex');

    const accessToken = this.jwtService.sign(
      { sub: userId, sid: sessionId },
      { expiresIn: this.sessionTTL },
    );

    await this.createSession(
      sessionId,
      userId,
      publicKey,
      metadata,
      familyId,
      this.hashToken(refreshToken),
    );
    await this.storeRefreshToken(refreshToken, sessionId, userId, familyId);

    return { accessToken, refreshToken, expiresIn: this.sessionTTL };
  }

  /**
   * Rotate tokens: validate the refresh token, revoke the old session,
   * and issue a fresh pair.
   */
  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    const payload = await this.consumeRefreshToken(refreshToken);
    const session = await this.getSession(payload.sessionId);
    if (!session)
      throw new UnauthorizedException('Session not found or expired');

    // Revoke old session before issuing new one (token rotation)
    await this.deleteSession(payload.sessionId, true);

    return this.issueTokens(
      session.userId,
      session.publicKey,
      session.metadata,
      payload.familyId,
    );
  }

  // ── Session CRUD ─────────────────────────────────────────────────────────

  async createSession(
    sessionId: string,
    userId: string,
    publicKey: string,
    metadata?: Record<string, any>,
    familyId?: string,
    refreshTokenHash?: string,
  ): Promise<void> {
    const now = Date.now();
    const sessionData: SessionData = {
      userId,
      publicKey,
      createdAt: now,
      lastActivity: now,
      metadata,
      familyId,
      refreshTokenHash,
    };

    await this.cacheSet(
      `session:${sessionId}`,
      this.encrypt(JSON.stringify(sessionData)),
      this.sessionTTL * 1000,
    );

    await this.addUserSession(userId, sessionId);
    this.logger.log(`Session created for user ${userId}: ${sessionId}`);
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    const raw = await this.cacheGet<string>(`session:${sessionId}`);
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
    await this.cacheSet(
      `session:${sessionId}`,
      this.encrypt(JSON.stringify(session)),
      this.sessionTTL * 1000,
    );
  }

  async deleteSession(
    sessionId: string,
    preserveRefreshToken = false,
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session) {
      await this.removeUserSession(session.userId, sessionId);
      if (!preserveRefreshToken && session.refreshTokenHash) {
        await this.cacheDelete(`refresh:${session.refreshTokenHash}`);
      }
    }
    await this.cacheDelete(`session:${sessionId}`);
    this.logger.log(`Session revoked: ${sessionId}`);
  }

  /** Revoke all sessions for a user (logout everywhere / suspicious activity). */
  async deleteAllUserSessions(userId: string): Promise<void> {
    const sessions = await this.getUserSessions(userId);
    await Promise.all(sessions.map((id) => this.deleteSession(id)));
    await this.cacheDelete(`user_sessions:${userId}`);
    this.logger.log(`All sessions revoked for user ${userId}`);
  }

  async getUserSessions(userId: string): Promise<string[]> {
    const raw = await this.cacheGet<string>(`user_sessions:${userId}`);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async getActiveSessionCount(): Promise<number> {
    return 0; // Redis SCAN required for accurate count in production
  }

  // ── Refresh token helpers ─────────────────────────────────────────────────

  private async storeRefreshToken(
    token: string,
    sessionId: string,
    userId: string,
    familyId: string,
  ): Promise<void> {
    const payload = JSON.stringify({
      sessionId,
      userId,
      familyId,
      consumed: false,
    });
    await this.cacheSet(
      `refresh:${this.hashToken(token)}`,
      this.encrypt(payload),
      this.refreshTTL * 1000,
    );
  }

  private async consumeRefreshToken(
    token: string,
  ): Promise<{ sessionId: string; userId: string; familyId: string }> {
    const key = `refresh:${this.hashToken(token)}`;
    const raw = await this.cacheGet<string>(key);
    if (!raw)
      throw new UnauthorizedException('Invalid or expired refresh token');

    try {
      const payload = JSON.parse(this.decrypt(raw));
      if (payload.consumed) {
        await this.deleteTokenFamily(payload.userId, payload.familyId);
        this.events?.emit('security.refresh_token_reuse', payload);
        throw new UnauthorizedException('Refresh token reuse detected');
      }
      await this.cacheSet(
        key,
        this.encrypt(JSON.stringify({ ...payload, consumed: true })),
        this.refreshTTL * 1000,
      );
      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Malformed refresh token');
    }
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async cacheGet<T>(key: string): Promise<T | undefined> {
    try {
      return await this.withTimeout(this.cacheManager.get<T>(key));
    } catch (error) {
      this.logger.warn(`Session cache unavailable for read: ${this.errorMessage(error)}`);
      throw new UnauthorizedException('Session service temporarily unavailable');
    }
  }

  private async cacheSet<T>(key: string, value: T, ttl: number): Promise<void> {
    try {
      await this.withTimeout(this.cacheManager.set(key, value, ttl));
    } catch (error) {
      this.logger.warn(`Session cache unavailable for write: ${this.errorMessage(error)}`);
      throw new UnauthorizedException('Session service temporarily unavailable');
    }
  }

  private async cacheDelete(key: string): Promise<void> {
    try {
      await this.withTimeout(this.cacheManager.del(key));
    } catch (error) {
      this.logger.warn(`Session cache unavailable for delete: ${this.errorMessage(error)}`);
      throw new UnauthorizedException('Session service temporarily unavailable');
    }
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Redis operation timed out after ${this.cacheTimeoutMs}ms`)),
            this.cacheTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async deleteTokenFamily(
    userId: string,
    familyId: string,
  ): Promise<void> {
    const ids = await this.getUserSessions(userId);
    for (const id of ids) {
      const session = await this.getSession(id);
      if (session?.familyId === familyId) await this.deleteSession(id);
    }
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
      await this.cacheDelete(`session:${oldest}`);
      this.logger.log(`Evicted oldest session for user ${userId}: ${oldest}`);
    }
    sessions.push(sessionId);
    await this.cacheSet(
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
      await this.cacheSet(
        `user_sessions:${userId}`,
        JSON.stringify(sessions),
        this.refreshTTL * 1000,
      );
    } else {
      await this.cacheDelete(`user_sessions:${userId}`);
    }
  }
}
