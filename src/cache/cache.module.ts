import { Module, Global } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { redisStore } from 'cache-manager-redis-yet';
import { FeedCacheStrategy } from './strategies/feed-cache.strategy';
import { ProviderCacheStrategy } from './strategies/provider-cache.strategy';
import { PriceCacheStrategy } from './strategies/price-cache.strategy';
import { CacheInvalidatorService } from './invalidation/cache-invalidator.service';
import { CacheMetricsService } from './monitoring/cache-metrics.service';
import { CacheController } from './cache.controller';
import { CacheService } from './cache.service';
import { CacheInvalidationService } from './cache-invalidation.service';
import { SignalCacheInvalidationListener } from './signal-cache-invalidation.listener';
import { TradeCacheInvalidationListener } from './trade-cache-invalidation.listener';
import { ResponseCacheService, ResponseCacheInterceptor } from './response-cache.service';
import { TradingCacheService } from './trading-cache.service';
import { CacheWarmupService } from './cache-warmup.service';
import { CacheReconciliationJob } from './cache-reconciliation.job';
import { Signal } from '../signals/entities/signal.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Signal]),
    ScheduleModule.forRoot(),
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
    SignalCacheInvalidationListener,
    TradeCacheInvalidationListener,
    ResponseCacheService,
    ResponseCacheInterceptor,
    TradingCacheService,
    CacheWarmupService,
    CacheReconciliationJob,
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
    SignalCacheInvalidationListener,
    TradeCacheInvalidationListener,
    ResponseCacheService,
    ResponseCacheInterceptor,
    TradingCacheService,
    CacheWarmupService,
  ],
})
export class CacheModule { }
