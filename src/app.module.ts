import {
  Injectable,
  Module,
  MiddlewareConsumer,
  NestModule,
  OnApplicationBootstrap,
  RequestMethod,
} from '@nestjs/common';
import { APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BullModule } from '@nestjs/bull';
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
import configuration from './config/configuration';
import { validateEnv } from './config/schemas/config.schema';
import { configuration } from './config/configuration';
import { nplus1DetectionConfig } from './config/nplus1.config';
import { queueRetryConfig } from './queue/queue-retry.config';
import { retryPolicyConfig } from './common/retry/retry-policy.config';
import { RetryModule } from './common/retry/retry.module';
import { validateEnvironment } from './config/schemas/config.schema';
import { ConfigValidationService } from './config/config-validation.service';
import { StellarConfigService } from './config/stellar.service';
import { HorizonBulkheadModule } from './stellar/bulkhead/horizon-bulkhead.module';
import { TenancyModule } from './tenancy/tenancy.module';

import { LoggerModule } from './common/logger';
import { CorrelationModule } from './common/correlation';
import { ShutdownModule } from './common/shutdown';
import { SentryModule } from './common/sentry';
import { ErrorClassificationModule } from './common/error-classification/error-classification.module';
import { CacheModule } from './cache/cache.module';
import { MaxCallDepthModule } from './common/max-call-depth.module';
import { IdempotentModule } from './common/idempotent.module';
import { BullCorrelationModule } from './common/bull/bull-correlation.module';

import { RequestContextModule } from './common/request-context/request-context.module';
import { RequestContextMiddleware } from './common/request-context/request-context.middleware';
import { TenantContextGuard } from './common/request-context/tenant-context.guard';

import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { QueryPerformanceInterceptor } from './common/interceptors/query-performance.interceptor';
import { RateLimitGuard } from './common/guards/rate-limit.guard';

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
import { AdminModule } from './admin/admin.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { OutboxModule } from './outbox/outbox.module';
import { SecurityAuditModule } from './audit-log/security/security-audit.module';
import { DrModule } from './disaster-recovery/dr.module';
import { MarketIntelligenceModule } from './market-intelligence/market-intelligence.module';
import { DocumentationModule } from './documentation/documentation.module';
import { CompetitionsModule } from './competitions/competitions.module';
import { NftModule } from './nft/nft.module';
import { RequestValidationMiddleware } from './common/middleware/request-validation.middleware';
import { HealthModule } from './health/health.module';
import { RateLimitModule } from './common/rate-limit.module';
import { DiscordBotModule } from './integrations/discord/discord-bot.module';
import { TelegramBotModule } from './integrations/telegram/telegram-bot.module';
import { RateLimitMiddleware } from './common/middleware/rate-limit.middleware';
import { LeaderboardModule } from './leaderboard/leaderboard.module';

// feature/293-mobile-api-optimizations
import { MobileModule } from './mobile/mobile.module';
import { AutomationModule } from './integrations/automation-platforms/automation.module';
import { CurrencyModule } from './currency/currency.module';
import { ImportModule } from './import/import.module';
import { ExportsModule } from './exports/exports.module';
import { HttpRetryModule } from './http/http.module';
import { ComplianceModule } from './compliance/compliance.module';
import { PriceOracleModule } from './prices/price-oracle.module';
import { PaymentsModule } from './payments/payments.module';
import { LocalPaymentModule } from './payments/local-methods/local-payment.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { I18nModule } from './i18n/i18n.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit-log/audit.module';
import { RetentionModule } from './common/retention/retention.module';
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
import { PrivacyModule } from './privacy/privacy.module';
import { TracingModule } from './tracing/tracing.module';
import { SearchModule } from './search/search.module';

const REQUIRED_TIMESTAMP_PRECISION = 3;
const DATABASE_TIME_ZONE_PATTERN = /^[A-Za-z0-9_+/:.-]+$/;

function getDatabaseSessionOptions(timeZone: string): string {
  if (!DATABASE_TIME_ZONE_PATTERN.test(timeZone)) {
    throw new Error(
      'DATABASE_TIME_ZONE must be a PostgreSQL time zone name without whitespace or quotes.',
    );
  }

  return `-c TimeZone=${timeZone}`;
}

export async function validateDatabaseTimestampSettings(
  query: (sql: string, parameters?: unknown[]) => Promise<unknown>,
  expectedTimeZone: string,
): Promise<void> {
  getDatabaseSessionOptions(expectedTimeZone);

  const result = await query(
    `SELECT current_setting('TimeZone') AS session_time_zone,
            COALESCE(
              array_agg(
                format('%I.%I.%I', schema_name, table_name, column_name)
                ORDER BY schema_name, table_name, column_name
              ) FILTER (WHERE timestamp_precision < $1),
              ARRAY[]::text[]
            ) AS low_precision_columns
       FROM (
         SELECT n.nspname AS schema_name,
                c.relname AS table_name,
                a.attname AS column_name,
                CASE
                  WHEN a.atttypmod < 0 THEN 6
                  ELSE a.atttypmod - 4
                END AS timestamp_precision
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE a.attnum > 0
            AND NOT a.attisdropped
            AND a.atttypid IN ('timestamp'::regtype, 'timestamptz'::regtype)
            AND c.relkind IN ('r', 'p')
            AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       ) timestamp_columns`,
    [REQUIRED_TIMESTAMP_PRECISION],
  );

  const [settings] = result as Array<{
    session_time_zone: string;
    low_precision_columns: string[];
  }>;
  if (!settings) {
    throw new Error(
      'Database timestamp settings check returned no session settings.',
    );
  }

  if (settings.session_time_zone !== expectedTimeZone) {
    throw new Error(
      `Database session time zone is ${JSON.stringify(settings.session_time_zone)}; ` +
        `expected ${JSON.stringify(expectedTimeZone)}. Set DATABASE_TIME_ZONE and verify the database connection settings.`,
    );
  }

  const lowPrecisionColumns = settings.low_precision_columns ?? [];
  if (lowPrecisionColumns.length > 0) {
    throw new Error(
      `Database timestamp precision must be at least ${REQUIRED_TIMESTAMP_PRECISION} digits ` +
        `(milliseconds); update these columns: ${lowPrecisionColumns.join(', ')}.`,
    );
  }
}

@Injectable()
class DatabaseTimestampSettingsCheck implements OnApplicationBootstrap {
  constructor(
    private readonly configService: ConfigService,
    @InjectDataSource() private readonly primaryDataSource: DataSource,
    @InjectDataSource('replica') private readonly replicaDataSource: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const timeZone =
      this.configService.get<string>('DATABASE_TIME_ZONE') ?? 'UTC';

    await validateDatabaseTimestampSettings(
      (sql, parameters) => this.primaryDataSource.query(sql, parameters),
      timeZone,
    );
    await validateDatabaseTimestampSettings(
      (sql, parameters) => this.replicaDataSource.query(sql, parameters),
      timeZone,
    );
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        // Anonymous traffic: strict default bucket keyed by IP.
        { name: 'anonymous', ttl: 60_000, limit: 60 },
        // Authenticated users: higher ceiling keyed by user id.
        { name: 'authenticated', ttl: 60_000, limit: 300 },
        // Suspicious IP ranges: aggressive bucket keyed by IP.
        { name: 'suspicious', ttl: 60_000, limit: 10 },
      ],
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
      cache: true,
      validate: validateEnv,
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
          options: getDatabaseSessionOptions(
            configService.get<string>('DATABASE_TIME_ZONE') ?? 'UTC',
          ),
          min: configService.get<number>('connectionPool.min') ?? 10,
          max: configService.get<number>('connectionPool.max') ?? 30,
          idleTimeoutMillis:
            configService.get<number>('connectionPool.idleTimeoutMillis') ??
            30000,
          connectionTimeoutMillis:
            configService.get<number>(
              'connectionPool.connectionTimeoutMillis',
            ) ?? 2000,
          statement_timeout:
            configService.get<number>('database.writeTimeoutMs') ?? 10000,
          query_timeout:
            configService.get<number>('database.readTimeoutMs') ?? 5000,
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
        port: configService.get<number>('database.replica.port'),
        username: configService.get<string>('database.replica.username'),
        password: configService.get<string>('database.replica.password'),
        database: configService.get<string>('database.replica.database'),
        synchronize: false,
        logging: false,
        entities: ['dist/**/*.entity{.ts,.js}'],
        ssl: configService.get<boolean>('database.replica.ssl') ?? false,
        extra: {
          options: getDatabaseSessionOptions(
            configService.get<string>('DATABASE_TIME_ZONE') ?? 'UTC',
          ),
          min: configService.get<number>('connectionPoolReplica.min') ?? 5,
          max: configService.get<number>('connectionPoolReplica.max') ?? 20,
          statement_timeout:
            configService.get<number>('database.readTimeoutMs') ?? 5000,
          query_timeout:
            configService.get<number>('database.readTimeoutMs') ?? 5000,
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

    RequestContextModule,
    CorrelationModule,
    ShutdownModule,
    LoggerModule,
    SentryModule,
    RetryModule,
    ErrorClassificationModule,
    MaxCallDepthModule,
    IdempotentModule,
    BullCorrelationModule,
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
    KycModule,
    ProductAnalyticsModule,
    BackupModule,
    AdminAnalyticsModule,
    AdminModule,
    MonitoringModule,
    WebhooksModule,
    OutboxModule,
    SecurityAuditModule,
    DrModule,
    MarketIntelligenceModule,
    DocumentationModule,
    CompetitionsModule,
    NftModule,
    HealthModule,
    RateLimitModule,
    DiscordBotModule,
    TelegramBotModule,
    MobileModule,
    AutomationModule,
    CurrencyModule,
    ImportModule,
    ExportsModule,
    HttpRetryModule,
    ComplianceModule,
    PriceOracleModule,
    PaymentsModule,
    LocalPaymentModule,
    FeatureFlagsModule,
    I18nModule,
    PortfolioModule,
    NotificationsModule,
    AuditModule,
    RetentionModule,
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
    PrivacyModule,
    TracingModule,
    TenancyModule,
    SearchModule,
  ],
  controllers: [],
  providers: [
    DatabaseTimestampSettingsCheck,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: QueryPerformanceInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantContextGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, RequestContextMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }

  /**
   * Builds the OpenAPI document configuration, documenting the supported
   * authentication flows, API key usage, and permission scopes so that
   * generated clients and developers can understand the service contract.
   */
  static buildOpenApiConfig() {
    return new DocumentBuilder()
      .setTitle('API')
      .setDescription(
        'Service contract describing authentication flows, API key usage, and permission scopes.',
      )
      .setVersion('1.0')
      // Bearer token authentication (OAuth2 / JWT authorization code flow).
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'JWT access token obtained through the authorization code flow. Send as `Authorization: Bearer <token>`.',
        },
        'bearer',
      )
      // OAuth2 authorization code flow with permission scopes.
      .addOAuth2(
        {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: '/oauth/authorize',
              tokenUrl: '/oauth/token',
              scopes: {
                'read:resources': 'Read access to resources',
                'write:resources': 'Create and update resources',
                'admin:resources': 'Administrative access to resources',
              },
            },
          },
          description:
            'OAuth2 authorization code flow. Request the permission scopes required by each endpoint.',
        },
        'oauth2',
      )
      // API key authentication for server-to-server integrations.
      .addApiKey(
        {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description:
            'API key issued to trusted integrations. Send as the `X-API-Key` header.',
        },
        'apiKey',
      )
      .addSecurityRequirements('bearer')
      .build();
  }

  /**
   * Registers the OpenAPI document with the given application instance so the
   * security schemes are observable through the generated schema.
   */
  static setupOpenApi(app: Parameters<typeof SwaggerModule.createDocument>[0]) {
    const document = SwaggerModule.createDocument(app, AppModule.buildOpenApiConfig());
    SwaggerModule.setup('api', app, document);
    return document;
  }
}
