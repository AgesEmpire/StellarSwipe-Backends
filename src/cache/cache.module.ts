import { Module, Global } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';
import { FeedCacheStrategy } from './strategies/feed-cache.strategy';
import { ProviderCacheStrategy } from './strategies/provider-cache.strategy';
import { PriceCacheStrategy } from './strategies/price-cache.strategy';
import { CacheInvalidatorService } from './invalidation/cache-invalidator.service';
import { CacheMetricsService } from './monitoring/cache-metrics.service';
import { CacheController } from './cache.controller';
import { CacheService } from './cache.service';
import { CacheInvalidationService } from './cache-invalidation.service';

@Global()
@Module({
  imports: [
    NestCacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const store = await redisStore({
          socket: {
            host: configService.get<string>('redisCache.host'),
            port: configService.get<number>('redisCache.port'),
          },
          password: configService.get<string>('redisCache.password'),
          database: configService.get<number>('redisCache.db'),
          ttl: configService.get<number>('redisCache.ttl.default') || 60,
        });

        return {
          store: store as any,
        };
      },
    }),
  ],
  providers: [
    CacheService,
    FeedCacheStrategy,
    ProviderCacheStrategy,
    PriceCacheStrategy,
    CacheInvalidatorService,
    CacheMetricsService,
    CacheInvalidationService,
  ],
  controllers: [CacheController],
  exports: [
    CacheService,
    FeedCacheStrategy,
    ProviderCacheStrategy,
    PriceCacheStrategy,
    CacheInvalidatorService,
    CacheMetricsService,
    CacheInvalidationService,
  ],
})
export class CacheModule { }