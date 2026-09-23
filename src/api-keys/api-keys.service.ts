import { Injectable, UnauthorizedException } from '@nestjs/common';
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

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepo: Repository<ApiKey>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async create(
    userId: string,
    dto: CreateApiKeyDto,
  ): Promise<ApiKeyResponseDto> {
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

    const saved = await this.apiKeyRepo.save(apiKey);

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
        await this.apiKeyRepo.update(key.id, { lastUsed: new Date() });
        return key;
      }
    }

    throw new UnauthorizedException('Invalid API key');
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

    const rawKey = `sk_live_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = await bcrypt.hash(rawKey, 10);

    await this.apiKeyRepo.update(keyId, {
      previousKeyHash: existing.keyHash,
      keyHash,
      overlapUntil: new Date(
        Date.now() + Math.max(0, Math.min(overlapMs, 3_600_000)),
      ),
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

  async revoke(userId: string, keyId: string): Promise<void> {
    await this.apiKeyRepo.update(
      { id: keyId, userId },
      { revokedAt: new Date(), previousKeyHash: null, overlapUntil: null },
    );
  }

  async list(userId: string): Promise<ApiKey[]> {
    return this.apiKeyRepo.find({ where: { userId } });
  }
}
