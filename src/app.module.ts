import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule } from '@nestjs/throttler';
// import { CacheModule } from '@nestjs/cache-manager';
import { stellarConfig } from './config/stellar.config';
import { databaseConfig, redisConfig } from './config/database.config';
import {
  connectionPoolConfig,
  connectionPoolReplicaConfig,
} from './database/config/connection-pool.config';
import { xaiConfig } from './config/xai.config';

import { appConfig, sentryConfig } from './config/app.config';
import { jwtConfig } from './config/jwt.config';
import { redisCacheConfig } from './config/redis.config';
import { configuration } from './config/configuration';
import { nplus1DetectionConfig } from './config/nplus1.config';
import { configSchema } from './config/schemas/config.schema';
import { StellarConfigService } from './config/stellar.service';
import { HorizonBulkheadModule } from './stellar/bulkhead/horizon-bulkhead.module';

import { LoggerModule } from './common/logger';
import { CorrelationModule } from './common/correlation';
import { SentryModule } from './common/sentry';
import { ErrorClassificationModule } from './common/error-classification/error-classification.module';
import { CacheModule } from './cache/cache.module';
import { MaxCallDepthModule } from './common/max-call-depth.module';

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
import { EncryptedStorageModule } from './storage/encryption/encrypted-storage.module';
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
import { RateLimitMiddleware } from './common/middleware/rate-limit.middleware';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
// feature/295-discord-community-integration
import { DiscordBotModule } from './integrations/discord/discord-bot.module';

// feature/294-telegram-bot-integration
import { TelegramBotModule } from './integrations/telegram/telegram-bot.module';

// feature/293-mobile-api-optimizations
import { MobileModule } from './mobile/mobile.module';

import { AutomationModule } from './integrations/automation-platforms/automation.module';
import { CurrencyModule } from './currency/currency.module';
import { ImportModule } from './import/import.module';
import { ExportsModule } from './exports/exports.module';
import { HttpRetryModule } from './http/http.module';
import { I18nModule } from './i18n/i18n.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit-log/audit.module';
import { AssetsModule } from './assets/assets.module';
import { SocialExportModule } from './social-export/social-export.module';
import { LowBalanceAlertModule } from './alerts/low-balance-alert.module';
import { OrdersModule } from './orders/orders.module';
import { ComplianceAuditExportModule } from './compliance/audit-export/compliance-audit-export.module';
import { SwapModule } from './swap/swap.module';
import { RiskControlsModule } from './risk-controls/risk-controls.module';
import { WalletModule } from './wallet/wallet.module';
import { FreighterModule } from './freighter/freighter.module';
import { WatchlistModule } from './watchlist/watchlist.module';

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
        connectionPoolReplicaConfig,
        configuration,
        nplus1DetectionConfig,
      ],
      // eslint-disable-next-line no-restricted-syntax -- ConfigModule bootstrap runs before the DI container (and ConfigService) exist.
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
        subscribers: [
          'dist/subscribers/*{.ts,.js}',
          'dist/common/subscribers/*{.ts,.js}',
          'dist/database/subscribers/*{.ts,.js}',
        ],
        ssl: configService.get<boolean>('database.ssl') ?? false,
        extra: {
          min: configService.get<number>('connectionPool.min') ?? 10,
          max: configService.get<number>('connectionPool.max') ?? 30,
          idleTimeoutMillis:
            configService.get<number>('connectionPool.idleTimeoutMillis') ??
            30000,
          connectionTimeoutMillis:
            configService.get<number>(
              'connectionPool.connectionTimeoutMillis',
            ) ?? 2000,
        },
      }),
    }),

    TypeOrmModule.forRootAsync({
      name: 'replica',
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        host: configService.get<string>('database.replica.host'),
        port: configService.get<number>('database.replica.port'),n        username: configService.get<string>('database.replica.username'),
        password: configService.get<string>('database.replica.password'),
        database: configService.get<string>('database.replica.database'),
        synchronize: false,
        logging: false,
        entities: ['dist/**/*.entity{.ts,.js}'],
        ssl: configService.get<boolean>('database.replica.ssl') ?? false,
        extra: {
          min: configService.get<number>('connectionPoolReplica.min') ?? 5,
          max: configService.get<number>('connectionPoolReplica.max') ?? 20,
          idleTimeoutMillis:
            configService.get<number>(
              'connectionPoolReplica.idleTimeoutMillis',
            ) ?? 30000,
          connectionTimeoutMillis:
            configService.get<number>(
              'connectionPoolReplica.connectionTimeoutMillis',
            ) ?? 2000,
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

    CorrelationModule,
    LoggerModule,
    SentryModule,
    ErrorClassificationModule,
    MaxCallDepthModule,
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
    WatchlistModule,
    LeaderboardModule,
    MlModule,
    ScalingModule,
    VersioningModule,
    ReferralsModule,
    EventsModule,
    ApiKeysModule,
    SecurityModule,
    SecurityMonitoringModule,
    AccessControlModule,
    EncryptedStorageModule,
    QuotaReportingModule,
    MarketDataHistoryModule,
    ContractsModule,
    KycModule,
    ProductAnalyticsModule,
    BackupModule,
    AdminAnalyticsModule,
    MetadataExtractorService,
    NPlus1DetectionInterceptor,
    MarketIntelligenceModule,
    DocumentationModule,
    CompetitionsModule,
    NftModule,
    HealthModule,
    RateLimitModule,
    // feature/295-discord-community-integration
    DiscordBotModule,

    // feature/294-telegram-bot-integration
    TelegramBotModule,

    // feature/293-mobile-api-optimizations
    MobileModule,

    AutomationModule,
    CurrencyModule,
    ImportModule,
    ExportsModule,
    HttpRetryModule,
    I18nModule,
    PortfolioModule,
    NotificationsModule,
    AuditModule,
    AssetsModule,
    SocialExportModule,
    LowBalanceAlertModule,
    OrdersModule,
    ComplianceAuditExportModule,
    SwapModule,
    RiskControlsModule,
    WalletModule,
    FreighterModule,
    HorizonBulkheadModule,
  ],
  providers: [StellarConfigService, RateLimitMiddleware],
  exports: [StellarConfigService],
})
export class AppModule { }
