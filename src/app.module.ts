import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule } from '@nestjs/throttler';
// import { CacheModule } from '@nestjs/cache-manager';
import { stellarConfig } from './config/stellar.config';
import { databaseConfig, redisConfig } from './config/database.config';
import { connectionPoolConfig } from './database/config/connection-pool.config';
import { xaiConfig } from './config/xai.config';

import { appConfig, sentryConfig } from './config/app.config';
import { jwtConfig } from './config/jwt.config';
import { redisCacheConfig } from './config/redis.config';
import configuration from './config/configuration';
import { configSchema } from './config/schemas/config.schema';
import { StellarConfigService } from './config/stellar.service';

import { LoggerModule } from './common/logger';
import { SentryModule } from './common/sentry';
import { CacheModule } from './cache/cache.module';

import { AuthModule } from './auth/auth.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { WebsocketModule } from './websocket/websocket.module';
import { ApiMonetizationModule } from './api-monetization/api-monetization.module';
import { SlaModule } from './enterprise/sla/sla.module';
import { UsersModule } from './users/users.module';
import { SignalsModule } from './signals/signals.module';
import { TradesModule } from './trades/trades.module';
import { ProvidersModule } from './providers/providers.module';
import { MlModule } from './ml/ml.module';
import { ScalingModule } from './scaling/scaling.module';
import { VersioningModule } from './versioning/versioning.module';
import { ReferralsModule } from './referrals/referrals.module';
import { EventsModule } from './events/events.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { SecurityModule } from './security/security.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SecurityMonitoringModule } from './security/security-monitoring.module';
import { AccessControlModule } from './security/access-control/access-control.module';
import { KycModule } from './kyc/kyc.module';
import { ProductAnalyticsModule } from './analytics/product-analytics.module';
import { BackupModule } from './backup/backup.module';
import { AdminAnalyticsModule } from './admin/analytics/admin-analytics.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { DrModule } from './disaster-recovery/dr.module';
import { MarketIntelligenceModule } from './market-intelligence/market-intelligence.module';
import { DocumentationModule } from './documentation/documentation.module';
import { CompetitionsModule } from './competitions/competitions.module';
import { NftModule } from './nft/nft.module';
import { HealthModule } from './health/health.module';
import { RateLimitModule } from './common/rate-limit.module';
 feature/295-discord-community-integration
import { DiscordBotModule } from './integrations/discord/discord-bot.module';

 feature/294-telegram-bot-integration
import { TelegramBotModule } from './integrations/telegram/telegram-bot.module';

 feature/293-mobile-api-optimizations
import { MobileModule } from './mobile/mobile.module';

import { AutomationModule } from './integrations/automation-platforms/automation.module';
import { CurrencyModule } from './currency/currency.module';
import { ImportModule } from './import/import.module';
import { ExportsModule } from './exports/exports.module';
import { HttpRetryModule } from './http/http.module';
 main
 main
 main

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        sentryConfig,
        stellarConfig,
        databaseConfig,
        redisConfig,
        redisCacheConfig,
        jwtConfig,
        xaiConfig,
        connectionPoolConfig,
        configuration,
      ],
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
      cache: true,
      validationSchema: configSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('redis.host') ?? 'localhost',
          port: configService.get<number>('redis.port') ?? 6379,
          password: configService.get<string>('redis.password'),
          db: configService.get<number>('redis.db') ?? 0,
        },
      }),
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        host: configService.get<string>('database.host'),
        port: configService.get<number>('database.port'),
        username: configService.get<string>('database.username'),
        password: configService.get<string>('database.password'),
        database: configService.get<string>('database.database'),
        synchronize: configService.get<boolean>('database.synchronize'),
        logging: configService.get<boolean>('database.logging'),
        entities: ['dist/**/*.entity{.ts,.js}'],
        migrations: ['dist/migrations/*{.ts,.js}'],
        subscribers: ['dist/subscribers/*{.ts,.js}'],
        ssl: configService.get<boolean>('database.ssl') ?? false,
        extra: {
          min: parseInt(process.env.DATABASE_POOL_MIN || '10', 10),
          max: parseInt(process.env.DATABASE_POOL_MAX || '30', 10),
          idleTimeoutMillis: parseInt(process.env.DATABASE_POOL_IDLE_TIMEOUT || '30000', 10),
          connectionTimeoutMillis: parseInt(process.env.DATABASE_POOL_CONNECTION_TIMEOUT || '2000', 10),
        },
      }),
    }),

    EventEmitterModule.forRoot(),

    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>('EXTERNAL_RATE_LIMIT_TTL') ?? 60000,
            limit: configService.get<number>('EXTERNAL_RATE_LIMIT_MAX') ?? 30,
          },
        ],
      }),
    }),

    LoggerModule,
    SentryModule,
    UsersModule,
    SignalsModule,
    TradesModule,
    CacheModule,
    AuthModule,
    AnalyticsModule,
    WebsocketModule,
    ApiMonetizationModule,
    SlaModule,
    ProvidersModule,
    MlModule,
    ScalingModule,
    VersioningModule,
    ReferralsModule,
    EventsModule,
    ApiKeysModule,
    SecurityModule,
    SecurityMonitoringModule,
    AccessControlModule,
    KycModule,
    ProductAnalyticsModule,
    BackupModule,
    AdminAnalyticsModule,
    MonitoringModule,
    WebhooksModule,
    DrModule,
    MarketIntelligenceModule,
    DocumentationModule,
    CompetitionsModule,
    NftModule,
    HealthModule,
    RateLimitModule,
 feature/295-discord-community-integration
    DiscordBotModule,

 feature/294-telegram-bot-integration
    TelegramBotModule,

 feature/293-mobile-api-optimizations
    MobileModule,

    AutomationModule,
    CurrencyModule,
    ImportModule,
    ExportsModule,
    HttpRetryModule,
 main
 main
 main
  ],
  providers: [StellarConfigService],
  exports: [StellarConfigService],
})
export class AppModule { }
