import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { DistributedLockService } from '../../common/services/distributed-lock.service';

const KEY_PREFIX = 'auth_challenge';
/** Lock TTL just needs to outlast a single consume() call. */
const CONSUME_LOCK_TTL_MS = 5000;

export enum ChallengeType {
  WEBAUTHN_REGISTRATION = 'webauthn_registration',
  WEBAUTHN_LOGIN = 'webauthn_login',
}

export interface ChallengeRecord {
  challenge: string;
  type: ChallengeType;
  userId?: string;
  sessionId?: string;
  expiresAt: number;
  data?: Record<string, unknown>;
}

export interface IssueChallengeParams {
  type: ChallengeType;
  /** Identifier the challenge is filed under (e.g. a user ID, or the challenge value itself for discoverable/userless flows). */
  key: string;
  challenge: string;
  ttlMs: number;
  userId?: string;
  sessionId?: string;
  data?: Record<string, unknown>;
}

export interface ConsumeChallengeParams {
  type: ChallengeType;
  key: string;
  /** When supplied, must match the stored challenge exactly. */
  challenge?: string;
  userId?: string;
  sessionId?: string;
}

/**
 * Single source of truth for short-lived, single-use auth challenges
 * (WebAuthn registration/login today; any future challenge-response flow
 * in the auth module can reuse it).
 *
 * - TTL-bound in the cache backend, so abandoned flows expire and are
 *   cleaned up automatically — cleanup is bounded by construction, no
 *   sweep job needed.
 * - `consume()` fetches-and-deletes under a distributed lock keyed by the
 *   same challenge slot, so two concurrent verification attempts for the
 *   same challenge can never both succeed (single-use / replay-proof).
 * - Optional userId/sessionId binding lets callers reject a challenge
 *   that is being redeemed by someone other than who it was issued to.
 */
@Injectable()
export class ChallengeStoreService {
  private readonly logger = new Logger(ChallengeStoreService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly lockService: DistributedLockService,
  ) {}

  async issue(params: IssueChallengeParams): Promise<void> {
    const record: ChallengeRecord = {
      challenge: params.challenge,
      type: params.type,
      userId: params.userId,
      sessionId: params.sessionId,
      expiresAt: Date.now() + params.ttlMs,
      data: params.data,
    };

    await this.cacheManager.set(
      this.buildKey(params.type, params.key),
      JSON.stringify(record),
      params.ttlMs,
    );
  }

  /**
   * Atomically fetches and deletes the challenge, then validates it.
   * Throws UnauthorizedException on any expiry/mismatch/binding failure or
   * if another caller is already mid-consumption for the same slot —
   * callers should let that propagate as a failed verification.
   */
  async consume(params: ConsumeChallengeParams): Promise<ChallengeRecord> {
    const cacheKey = this.buildKey(params.type, params.key);
    const lockKey = `${KEY_PREFIX}:lock:${params.type}:${params.key}`;

    const { ran, result } = await this.lockService.withLock(lockKey, CONSUME_LOCK_TTL_MS, async () => {
      const raw = await this.cacheManager.get<string>(cacheKey);
      if (!raw) {
        throw new UnauthorizedException('Challenge expired, already used, or not found.');
      }

      // Delete immediately (single-use) before validating, so nothing else
      // waiting on this slot can ever see or replay it, win or lose.
      await this.cacheManager.del(cacheKey);

      const record = JSON.parse(raw) as ChallengeRecord;

      if (record.expiresAt < Date.now()) {
        throw new UnauthorizedException('Challenge has expired.');
      }
      if (params.challenge && record.challenge !== params.challenge) {
        throw new UnauthorizedException('Challenge mismatch.');
      }
      if (params.userId && record.userId && record.userId !== params.userId) {
        throw new UnauthorizedException('Challenge does not belong to this user.');
      }
      if (params.sessionId && record.sessionId && record.sessionId !== params.sessionId) {
        throw new UnauthorizedException('Challenge does not belong to this session.');
      }

      return record;
    });

    if (!ran) {
      this.logger.warn(`Concurrent consumption attempt rejected for challenge slot ${cacheKey}`);
      throw new UnauthorizedException('Challenge is already being verified.');
    }

    return result as ChallengeRecord;
  }

  async invalidate(type: ChallengeType, key: string): Promise<void> {
    await this.cacheManager.del(this.buildKey(type, key));
  }

  private buildKey(type: ChallengeType, key: string): string {
    return `${KEY_PREFIX}:${type}:${key}`;
  }
}
