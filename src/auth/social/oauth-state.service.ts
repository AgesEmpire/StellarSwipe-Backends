import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as crypto from 'crypto';
import { DistributedLockService } from '../../common/services/distributed-lock.service';

const OAUTH_STATE_KEY_PREFIX = 'auth:oauth:state';
const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CONSUME_LOCK_TTL_MS = 5000;

export interface OAuthStateRecord {
  state: string;
  provider: string;
  userId?: string;
  redirectUri?: string;
  createdAt: number;
  expiresAt: number;
  metadata?: Record<string, unknown>;
}

export interface IssueOAuthStateOptions {
  provider: string;
  userId?: string;
  redirectUri?: string;
  ttlMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ConsumeOAuthStateOptions {
  state: string;
  provider?: string;
  userId?: string;
}

/**
 * OAuthStateService
 *
 * Implements atomic, single-use state validation for OAuth 2.0 / OIDC authentication
 * flows to prevent CSRF, replay attacks, and race conditions.
 *
 * Requirements (#1414):
 * - State values expire with a bounded lifetime (default: 10 minutes).
 * - State is consumed with a single atomic operation under distributed locking.
 * - Missing, expired, mismatched, or already-consumed values fail safely.
 */
@Injectable()
export class OAuthStateService {
  private readonly logger = new Logger(OAuthStateService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly lockService: DistributedLockService,
  ) {}

  /**
   * Generates a cryptographically secure random state value, stores it with TTL,
   * and returns the generated state string.
   */
  async generateState(options: IssueOAuthStateOptions): Promise<string> {
    const state = crypto.randomBytes(32).toString('hex');
    const ttlMs = options.ttlMs ?? DEFAULT_STATE_TTL_MS;
    const now = Date.now();

    const record: OAuthStateRecord = {
      state,
      provider: options.provider,
      userId: options.userId,
      redirectUri: options.redirectUri,
      createdAt: now,
      expiresAt: now + ttlMs,
      metadata: options.metadata,
    };

    const cacheKey = this.buildKey(state);
    await this.cacheManager.set(cacheKey, JSON.stringify(record), ttlMs);

    return state;
  }

  /**
   * Stores a caller-provided state string with bounded TTL.
   */
  async storeState(state: string, options: IssueOAuthStateOptions): Promise<void> {
    if (!state || typeof state !== 'string' || state.trim().length === 0) {
      throw new UnauthorizedException('Invalid OAuth state parameter');
    }

    const ttlMs = options.ttlMs ?? DEFAULT_STATE_TTL_MS;
    const now = Date.now();

    const record: OAuthStateRecord = {
      state,
      provider: options.provider,
      userId: options.userId,
      redirectUri: options.redirectUri,
      createdAt: now,
      expiresAt: now + ttlMs,
      metadata: options.metadata,
    };

    const cacheKey = this.buildKey(state);
    await this.cacheManager.set(cacheKey, JSON.stringify(record), ttlMs);
  }

  /**
   * Atomically consumes the state parameter, ensuring it can only be redeemed once.
   * Concurrent redemption attempts or replayed state values fail immediately.
   */
  async consumeState(options: ConsumeOAuthStateOptions): Promise<OAuthStateRecord> {
    const { state, provider, userId } = options;
    if (!state || typeof state !== 'string' || state.trim().length === 0) {
      throw new UnauthorizedException('Missing or invalid OAuth state parameter');
    }

    const cacheKey = this.buildKey(state);
    const lockKey = `${OAUTH_STATE_KEY_PREFIX}:lock:${state}`;

    const { ran, result } = await this.lockService.withLock(lockKey, CONSUME_LOCK_TTL_MS, async () => {
      const raw = await this.cacheManager.get<string>(cacheKey);
      if (!raw) {
        throw new UnauthorizedException('OAuth state expired, already used, or invalid');
      }

      // Atomically delete immediately before inspection to ensure single-use
      await this.cacheManager.del(cacheKey);

      let record: OAuthStateRecord;
      try {
        record = typeof raw === 'string' ? JSON.parse(raw) : (raw as unknown as OAuthStateRecord);
      } catch (err) {
        throw new UnauthorizedException('Malformed OAuth state record');
      }

      // Validate expiration
      if (record.expiresAt && record.expiresAt < Date.now()) {
        throw new UnauthorizedException('OAuth state has expired');
      }

      // Validate state value match using timing-safe equality
      const expectedBuf = Buffer.from(record.state);
      const actualBuf = Buffer.from(state);
      if (
        expectedBuf.length !== actualBuf.length ||
        !crypto.timingSafeEqual(expectedBuf, actualBuf)
      ) {
        throw new UnauthorizedException('OAuth state mismatch');
      }

      // Validate provider if specified
      if (provider && record.provider && record.provider !== provider) {
        throw new UnauthorizedException(`OAuth state provider mismatch: expected ${record.provider}, got ${provider}`);
      }

      // Validate bound user if specified
      if (userId && record.userId && record.userId !== userId) {
        throw new UnauthorizedException('OAuth state does not belong to the authenticating user');
      }

      return record;
    });

    if (!ran) {
      this.logger.warn(`Concurrent OAuth state consumption attempt blocked for state: ${state}`);
      throw new UnauthorizedException('OAuth state is currently being verified by another request');
    }

    return result as OAuthStateRecord;
  }

  private buildKey(state: string): string {
    return `${OAUTH_STATE_KEY_PREFIX}:${state}`;
  }
}
