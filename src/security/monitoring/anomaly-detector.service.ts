import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import {
  SecurityAlert,
  AlertType,
  AlertSeverity,
} from '../entities/security-alert.entity';

export interface AnomalyResult {
  detected: boolean;
  type?: AlertType;
  severity?: AlertSeverity;
  details?: Record<string, unknown>;
}

export interface LoginContext {
  userId: string;
  ipAddress: string;
  userAgent: string;
  location?: string;
  success: boolean;
}

export interface TradeContext {
  userId: string;
  volume: number;
  asset: string;
}

export interface WalletChangeContext {
  userId: string;
  newAddress: string;
  previousAddress?: string;
}

export interface ApiRequestContext {
  userId: string;
  apiKeyId: string;
  endpoint: string;
}

// Thresholds aligned with spec
const THRESHOLDS = {
  failedLogins: { count: 5, windowSeconds: 15 * 60 }, // 5 in 15 min
  rapidChanges: { count: 5, windowSeconds: 5 * 60 }, // 5 in 5 min
  apiRateAbuse: { count: 1000, windowSeconds: 60 * 60 }, // 1000 in 1 hr
  unusualVolume: { multiplier: 3 }, // 3x avg volume
};

@Injectable()
export class AnomalyDetectorService {
  private readonly logger = new Logger(AnomalyDetectorService.name);

  constructor(
    @InjectRepository(SecurityAlert)
    private readonly alertRepository: Repository<SecurityAlert>,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  // ─── Failed Login Detection ───────────────────────────────────────────────

  async detectFailedLogin(ctx: LoginContext): Promise<AnomalyResult> {
    if (ctx.success) return { detected: false };

    const key = `failed_logins:${ctx.userId}`;
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - THRESHOLDS.failedLogins.windowSeconds;

    // Use Redis sorted set: score = timestamp, member = timestamp:uuid
    await this.redis.zadd(key, now, `${now}:${Math.random()}`);
    await this.redis.zremrangebyscore(key, '-inf', windowStart);
    await this.redis.expire(key, THRESHOLDS.failedLogins.windowSeconds);

    const count = await this.redis.zcard(key);

    if (count >= THRESHOLDS.failedLogins.count) {
      this.logger.warn(
        `Failed login threshold reached for user ${ctx.userId}: ${count} attempts`,
      );
      return {
        detected: true,
        type: AlertType.FAILED_LOGIN,
        severity: AlertSeverity.CRITICAL,
        details: {
          failedAttempts: count,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          windowMinutes: THRESHOLDS.failedLogins.windowSeconds / 60,
        },
      };
    }

    // Warning at 3+ attempts
    if (count >= 3) {
      return {
        detected: true,
        type: AlertType.FAILED_LOGIN,
        severity: AlertSeverity.WARNING,
        details: {
          failedAttempts: count,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          windowMinutes: THRESHOLDS.failedLogins.windowSeconds / 60,
        },
      };
    }

    return { detected: false };
  }

  // ─── New Location Detection ───────────────────────────────────────────────

  async detectNewLocation(ctx: LoginContext): Promise<AnomalyResult> {
    if (!ctx.success || !ctx.location) return { detected: false };

    const key = `known_locations:${ctx.userId}`;
    const isKnown = await this.redis.sismember(key, ctx.location);

    if (!isKnown) {
      // Add to known locations after alerting
      await this.redis.sadd(key, ctx.location);
      await this.redis.expire(key, 90 * 24 * 60 * 60); // 90-day TTL

      this.logger.warn(
        `New location login for user ${ctx.userId}: ${ctx.location}`,
      );
      return {
        detected: true,
        type: AlertType.NEW_LOCATION,
        severity: AlertSeverity.WARNING,
        details: {
          newLocation: ctx.location,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          require2FA: true,
        },
      };
    }

    return { detected: false };
  }

  // ─── Unusual Trade Volume Detection ──────────────────────────────────────

  async detectUnusualTradeVolume(ctx: TradeContext): Promise<AnomalyResult> {
    const avgKey = `avg_trade_volume:${ctx.userId}:${ctx.asset}`;
    const storedAvg = await this.redis.get(avgKey);
    const avgVolume = storedAvg ? parseFloat(storedAvg) : null;

    // Update rolling average (exponential moving average, α=0.1)
    const newAvg =
      avgVolume == null ? ctx.volume : avgVolume * 0.9 + ctx.volume * 0.1;

    await this.redis.set(avgKey, newAvg.toString(), 'EX', 30 * 24 * 60 * 60);

    if (
      avgVolume &&
      ctx.volume > avgVolume * THRESHOLDS.unusualVolume.multiplier
    ) {
      this.logger.warn(
        `Unusual trade volume for user ${ctx.userId}: ${ctx.volume} vs avg ${avgVolume}`,
      );
      return {
        detected: true,
        type: AlertType.UNUSUAL_TRADE_VOLUME,
        severity: AlertSeverity.WARNING,
        details: {
          tradeVolume: ctx.volume,
          averageVolume: avgVolume,
          multiplier: ctx.volume / avgVolume,
          asset: ctx.asset,
          threshold: THRESHOLDS.unusualVolume.multiplier,
        },
      };
    }

    return { detected: false };
  }

  // ─── Rapid Wallet Change Detection ───────────────────────────────────────

  async detectRapidWalletChanges(
    ctx: WalletChangeContext,
  ): Promise<AnomalyResult> {
    const key = `wallet_changes:${ctx.userId}`;
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - THRESHOLDS.rapidChanges.windowSeconds;

    await this.redis.zadd(key, now, `${now}:${Math.random()}`);
    await this.redis.zremrangebyscore(key, '-inf', windowStart);
    await this.redis.expire(key, THRESHOLDS.rapidChanges.windowSeconds);

    const count = await this.redis.zcard(key);

    if (count >= THRESHOLDS.rapidChanges.count) {
      this.logger.warn(
        `Rapid wallet changes for user ${ctx.userId}: ${count} changes`,
      );
      return {
        detected: true,
        type: AlertType.RAPID_WALLET_CHANGES,
        severity: AlertSeverity.CRITICAL,
        details: {
          changeCount: count,
          windowMinutes: THRESHOLDS.rapidChanges.windowSeconds / 60,
          newAddress: ctx.newAddress,
          previousAddress: ctx.previousAddress,
        },
      };
    }

    return { detected: false };
  }

  // ─── API Rate Abuse Detection ─────────────────────────────────────────────

  async detectApiRateAbuse(ctx: ApiRequestContext): Promise<AnomalyResult> {
    const key = `api_requests:${ctx.apiKeyId}`;
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - THRESHOLDS.apiRateAbuse.windowSeconds;

    await this.redis.zadd(key, now, `${now}:${Math.random()}`);
    await this.redis.zremrangebyscore(key, '-inf', windowStart);
    await this.redis.expire(key, THRESHOLDS.apiRateAbuse.windowSeconds);

    const count = await this.redis.zcard(key);
    const threshold = THRESHOLDS.apiRateAbuse.count;

    if (count >= threshold) {
      this.logger.warn(
        `API rate abuse detected for user ${ctx.userId}: ${count} requests/hr`,
      );
      return {
        detected: true,
        type: AlertType.API_RATE_ABUSE,
        severity: AlertSeverity.CRITICAL,
        details: {
          requestCount: count,
          threshold,
          windowHours: 1,
          apiKeyId: ctx.apiKeyId,
          endpoint: ctx.endpoint,
        },
      };
    }

    // Warning at 80% of threshold
    if (count >= threshold * 0.8) {
      return {
        detected: true,
        type: AlertType.API_RATE_ABUSE,
        severity: AlertSeverity.WARNING,
        details: {
          requestCount: count,
          threshold,
          percentageUsed: (count / threshold) * 100,
          apiKeyId: ctx.apiKeyId,
        },
      };
    }

    return { detected: false };
  }

  // ─── Reset Counters (for testing / false positive resolution) ────────────

  async resetUserCounters(userId: string): Promise<void> {
    const keys = await this.redis.keys(`*:${userId}*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
      this.logger.log(`Reset security counters for user ${userId}`);
    }
  }

  async getFailedLoginCount(userId: string): Promise<number> {
    const key = `failed_logins:${userId}`;
    const windowStart =
      Math.floor(Date.now() / 1000) - THRESHOLDS.failedLogins.windowSeconds;
    await this.redis.zremrangebyscore(key, '-inf', windowStart);
    return this.redis.zcard(key);
  }
}
