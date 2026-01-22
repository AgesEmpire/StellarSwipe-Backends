import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  private redis: Redis;

  constructor(private configService: ConfigService) {
    super();
    this.redis = new Redis({
      host: this.configService.get<string>('redis.host') ?? 'localhost',
      port: this.configService.get<number>('redis.port') ?? 6379,
      password: this.configService.get<string>('redis.password'),
      db: this.configService.get<number>('redis.db') ?? 0,
      lazyConnect: true,
    });
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      await this.redis.connect();
      const pong = await this.redis.ping();
      const latency = Date.now() - startTime;

      const info = await this.redis.info('server');
      const versionMatch = info.match(/redis_version:(\S+)/);
      const version = versionMatch ? versionMatch[1] : 'unknown';

      await this.redis.disconnect();

      return this.getStatus(key, true, {
        status: pong === 'PONG' ? 'connected' : 'degraded',
        version,
        latency: `${latency}ms`,
      });
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      try {
        await this.redis.disconnect();
      } catch {
        // Ignore disconnect errors
      }

      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, {
          status: 'disconnected',
          error: errorMessage,
          latency: `${latency}ms`,
        }),
      );
    }
  }
}
