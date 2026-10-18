import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { ApiKey } from './entities/api-key.entity';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ApiKeyResponseDto, ApiKeyUsageDto } from './dto/api-key-usage.dto';

const MAX_OVERLAP_MS = 3_600_000;
const LAST_USED_THROTTLE_MS = 60_000;

@Injectable()
export class ApiKeysService {
  private readonly lastUsedInFlight = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepo: Repository<ApiKey>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    const configured = Number(process.env.MAX_ACTIVE_API_KEYS);
    this.maxActiveKeys =
      Number.isFinite(configured) && configured > 0
        ? Math.floor(configured)
        : DEFAULT_MAX_ACTIVE_KEYS;
  }

  /**
   * Atomically enforce the per-account active key limit and persist a new key.
   * Uses a pessimistic write lock on the account's active keys so concurrent
   * creations cannot both observe a below-limit count. Revoked keys are
   * excluded from the count.
   */
  private async saveWithActiveKeyLimit(
    apiKey: ApiKey,
  ): Promise<ApiKey> {
    return this.apiKeyRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(ApiKey);

      const activeCount = await repo
        .createQueryBuilder('apiKey')
        .setLock('pessimistic_write')
        .where('apiKey.userId = :userId', { userId: apiKey.userId })
        .andWhere('apiKey.revokedAt IS NULL')
        .getCount();

      if (activeCount >= this.maxActiveKeys) {
        throw new ConflictException(
          `Active API key limit of ${this.maxActiveKeys} reached for this account`,
        );
      }

      return repo.save(apiKey);
    });
  }

  async create(
    userId: string,
    dto: CreateApiKeyDto,
  ): Promise<ApiKeyResponseDto> {
    await this.assertEmailVerified(userId);

    const rawKey = `sk_live_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = await bcrypt.hash(rawKey, 10);

    const apiKey = this.apiKeyRepo.create({
      userId,
      name: dto.name,
      keyHash,
      scopes: dto.scopes,
      rateLimit: dto.rateLimit ?? 1000,
      expiresAt: dto.expiresAt,
    });

    const saved = await this.saveWithActiveKeyLimit(apiKey);

    return {
      id: saved.id,
      name: saved.name,
      key: rawKey,
      scopes: saved.scopes,
      expiresAt: saved.expiresAt,
      rateLimit: saved.rateLimit,
      createdAt: saved.createdAt,
    };
  }

  private async assertEmailVerified(userId: string): Promise<void> {
    const user = await this.apiKeyRepo.manager
      .getRepository('User')
      .findOne({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.emailVerified) {
      throw new ForbiddenException(
        'A verified email is required to create an API key',
      );
    }
  }

  async verify(rawKey: string): Promise<ApiKey> {
    const keys = await this.apiKeyRepo.find();

    for (const key of keys) {
      if (key.revokedAt) continue;
      if (
        key.previousKeyHash &&
        key.overlapUntil &&
        key.overlapUntil <= new Date()
      ) {
        await this.apiKeyRepo.update(key.id, {
          previousKeyHash: null,
          overlapUntil: null,
        });
        key.previousKeyHash = null;
      }
      const current = await bcrypt.compare(rawKey, key.keyHash);
      const overlap =
        !!key.previousKeyHash &&
        !!key.overlapUntil &&
        key.overlapUntil > new Date() &&
        (await bcrypt.compare(rawKey, key.previousKeyHash));
      const match = current || overlap;
      if (match) {
        if (key.expiresAt && key.expiresAt < new Date()) {
          throw new UnauthorizedException('API key expired');
        }
        await this.touchLastUsed(key);
        return key;
      }
    }

    throw new UnauthorizedException('Invalid API key');
  }

  /**
   * Records last-used time at a bounded interval instead of on every request.
   * Concurrent requests for the same key share a single in-flight write, and
   * writes are skipped when the stored timestamp is still fresh.
   */
  private async touchLastUsed(key: ApiKey): Promise<void> {
    const now = Date.now();
    if (key.lastUsed && now - key.lastUsed.getTime() < LAST_USED_THROTTLE_MS) {
      return;
    }

    const inFlight = this.lastUsedInFlight.get(key.id);
    if (inFlight) {
      await inFlight;
      return;
    }

    const write = this.apiKeyRepo
      .update(key.id, { lastUsed: new Date(now) })
      .then(() => {
        key.lastUsed = new Date(now);
      })
      .finally(() => {
        this.lastUsedInFlight.delete(key.id);
      });

    this.lastUsedInFlight.set(key.id, write);
    await write;
  }

  async checkRateLimit(keyId: string, limit: number): Promise<boolean> {
    const key = `ratelimit:apikey:${keyId}:${Math.floor(Date.now() / 3600000)}`;
    const cached = await this.cacheManager.get<number>(key);
    const count = (cached || 0) + 1;
    await this.cacheManager.set(key, count, 3600000);
    return count <= limit;
  }

  async trackUsage(keyId: string, endpoint: string, error: boolean) {
    const hour = Math.floor(Date.now() / 3600000);
    const reqKey = `usage:${keyId}:${hour}:requests`;
    const errKey = `usage:${keyId}:${hour}:errors`;
    const endpointKey = `usage:${keyId}:endpoints`;

    const requests = (await this.cacheManager.get<number>(reqKey)) || 0;
    await this.cacheManager.set(reqKey, requests + 1, 604800000);

    if (error) {
      const errors = (await this.cacheManager.get<number>(errKey)) || 0;
      await this.cacheManager.set(errKey, errors + 1, 604800000);
    }

    const endpoints =
      (await this.cacheManager.get<string[]>(endpointKey)) || [];
    if (!endpoints.includes(endpoint)) {
      endpoints.push(endpoint);
      await this.cacheManager.set(endpointKey, endpoints, 604800000);
    }
  }

  async getUsage(userId: string): Promise<ApiKeyUsageDto[]> {
    const keys = await this.apiKeyRepo.find({ where: { userId } });

    return Promise.all(
      keys.map(async (key) => {
        const hour = Math.floor(Date.now() / 3600000);
        const reqKey = `usage:${key.id}:${hour}:requests`;
        const errKey = `usage:${key.id}:${hour}:errors`;

        const requestCount =
          (await this.cacheManager.get<number>(reqKey)) || 0;
        const errorCount = (await this.cacheManager.get<number>(errKey)) || 0;

        return {
          id: key.id,
          name: key.name,
          scopes: key.scopes,
          lastUsed: key.lastUsed,
          expiresAt: key.expiresAt,
          rateLimit: key.rateLimit,
          createdAt: key.createdAt,
          requestCount,
          errorCount,
        };
      }),
    );
  }

  async rotate(
    userId: string,
    keyId: string,
    overlapMs = 300_000,
  ): Promise<ApiKeyResponseDto> {
    const existing = await this.apiKeyRepo.findOne({
      where: { id: keyId, userId },
    });

    if (!existing) {
      throw new UnauthorizedException('API key not found');
    }

    if (existing.revokedAt) {
      throw new UnauthorizedException('API key has been revoked');
    }

    const rawKey = `sk_live_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = await bcrypt.hash(rawKey, 10);

    const boundedOverlapMs = Number.isFinite(overlapMs)
      ? Math.max(0, Math.min(overlapMs, MAX_OVERLAP_MS))
      : 0;

    await this.apiKeyRepo.update(keyId, {
      previousKeyHash: existing.keyHash,
      keyHash,
      overlapUntil: new Date(Date.now() + boundedOverlapMs),
    });

    return {
      id: existing.id,
      name: existing.name,
      key: rawKey,
      scopes: existing.scopes,
      expiresAt: existing.expiresAt,
      rateLimit: existing.rateLimit,
      createdAt: existing.createdAt,
    };
  }

  async revoke(
    userId: string,
    keyId: string,
    revokedBy: string = userId,
    reason?: string,
  ): Promise<void> {
    const revokedAt = new Date();
    await this.apiKeyRepo.update(
      { id: keyId, userId },
      { revokedAt, previousKeyHash: null, overlapUntil: null },
    );

    // Append-only audit record. Never store key hashes, raw keys, or tokens.
    this.revocationHistory.push({
      id: crypto.randomUUID(),
      apiKeyId: keyId,
      userId,
      revokedBy,
      revokedAt,
      reason: reason ? reason.slice(0, 500) : null,
    });
  }

  /**
   * Return immutable revocation audit records for a key, scoped to the
   * owning account. Callers must be authorized for `userId`.
   */
  async getRevocationHistory(
    userId: string,
    keyId: string,
  ): Promise<ApiKeyRevocationRecord[]> {
    return this.revocationHistory
      .filter((record) => record.userId === userId && record.apiKeyId === keyId)
      .map((record) => ({ ...record }));
  }

  async list(userId: string): Promise<ApiKey[]> {
    return this.apiKeyRepo.find({ where: { userId } });
  }
}
