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

export type CriticalConstraintExpectation = {
  schemaName: string;
  tableName: string;
  constraintName?: string;
  kind: 'unique' | 'foreign';
  columns: string[];
  referencedSchema?: string;
  referencedTable?: string;
  referencedColumns?: string[];
  migration: string;
};

// Keep this list aligned with constraints created by the named migrations.
// Validation uses PostgreSQL catalogs only; it never reads application rows.
const CRITICAL_DATABASE_CONSTRAINTS: CriticalConstraintExpectation[] = [
  {
    schemaName: 'public',
    tableName: 'users',
    constraintName: 'UQ_users_username',
    kind: 'unique',
    columns: ['username'],
    migration: '1737561600000-CreateUserTables',
  },
  {
    schemaName: 'public',
    tableName: 'sessions',
    constraintName: 'UQ_sessions_token',
    kind: 'unique',
    columns: ['token'],
    migration: '1737561600000-CreateUserTables',
  },
  {
    schemaName: 'public',
    tableName: 'sessions',
    constraintName: 'FK_sessions_user',
    kind: 'foreign',
    columns: ['userId'],
    referencedSchema: 'public',
    referencedTable: 'users',
    referencedColumns: ['id'],
    migration: '1737561600000-CreateUserTables',
  },
  {
    schemaName: 'public',
    tableName: 'user_preferences',
    constraintName: 'FK_user_preferences_user',
    kind: 'foreign',
    columns: ['userId'],
    referencedSchema: 'public',
    referencedTable: 'users',
    referencedColumns: ['id'],
    migration: '1737561600000-CreateUserTables',
  },
  {
    schemaName: 'public',
    tableName: 'refresh_tokens',
    constraintName: 'UQ_refresh_tokens_hash',
    kind: 'unique',
    columns: ['token_hash'],
    migration: '1750000000000-AddRefreshTokens',
  },
  {
    schemaName: 'public',
    tableName: 'user_roles',
    constraintName: 'IDX_user_roles_user_id_role_id',
    kind: 'unique',
    columns: ['userId', 'roleId'],
    migration: '1705000000234-CreateUserRolesTable',
  },
  {
    schemaName: 'public',
    tableName: 'user_roles',
    kind: 'foreign',
    columns: ['roleId'],
    referencedSchema: 'public',
    referencedTable: 'roles',
    referencedColumns: ['id'],
    migration: '1705000000234-CreateUserRolesTable',
  },
  {
    schemaName: 'public',
    tableName: 'role_permissions',
    kind: 'foreign',
    columns: ['roleId'],
    referencedSchema: 'public',
    referencedTable: 'roles',
    referencedColumns: ['id'],
    migration: '1705000000234-CreateUserRolesTable',
  },
  {
    schemaName: 'public',
    tableName: 'role_permissions',
    kind: 'foreign',
    columns: ['permissionId'],
    referencedSchema: 'public',
    referencedTable: 'permissions',
    referencedColumns: ['id'],
    migration: '1705000000234-CreateUserRolesTable',
  },
  {
    schemaName: 'public',
    tableName: 'two_factor_auth',
    constraintName: 'UQ_two_factor_auth_user_id',
    kind: 'unique',
    columns: ['userId'],
    migration: '20260825000000-CreateTwoFactorAuthTable',
  },
  {
    schemaName: 'public',
    tableName: 'webauthn_credentials',
    constraintName: 'UQ_webauthn_credentials_credential_id',
    kind: 'unique',
    columns: ['credentialId'],
    migration: '1751000000000-CreateWebauthnCredentials',
  },
];

export async function validateCriticalDatabaseConstraints(
  query: (sql: string, parameters?: unknown[]) => Promise<unknown>,
  expectations: CriticalConstraintExpectation[] = CRITICAL_DATABASE_CONSTRAINTS,
): Promise<void> {
  if (expectations.length === 0) {
    return;
  }

  const result = (await query(
    `WITH expected AS (
       SELECT *
         FROM jsonb_to_recordset($1::jsonb) AS item(
           schema_name text,
           table_name text,
           constraint_name text,
           kind text,
           columns text[],
           referenced_schema text,
           referenced_table text,
           referenced_columns text[],
           migration text
         )
     )
     SELECT e.schema_name AS "schemaName",
            e.table_name AS "tableName",
            e.constraint_name AS "constraintName",
            e.kind, e.columns,
            e.referenced_schema AS "referencedSchema",
            e.referenced_table AS "referencedTable",
            e.referenced_columns AS "referencedColumns",
            e.migration
       FROM expected e
      WHERE NOT EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class tbl ON tbl.oid = c.conrelid
          JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
          LEFT JOIN pg_class ref_tbl ON ref_tbl.oid = c.confrelid
          LEFT JOIN pg_namespace ref_ns ON ref_ns.oid = ref_tbl.relnamespace
         WHERE tbl_ns.nspname = e.schema_name
           AND tbl.relname = e.table_name
           AND (e.constraint_name IS NULL OR c.conname = e.constraint_name)
           AND c.convalidated
           AND (
             (e.kind = 'unique' AND c.contype IN ('u', 'p')
               AND ARRAY(
                 SELECT a.attname::text
                   FROM unnest(c.conkey) WITH ORDINALITY key_col(attnum, ord)
                   JOIN pg_attribute a
                     ON a.attrelid = tbl.oid AND a.attnum = key_col.attnum
                  ORDER BY key_col.ord
               ) = e.columns)
             OR
             (e.kind = 'foreign' AND c.contype = 'f'
               AND ARRAY(
                 SELECT a.attname::text
                   FROM unnest(c.conkey) WITH ORDINALITY key_col(attnum, ord)
                   JOIN pg_attribute a
                     ON a.attrelid = tbl.oid AND a.attnum = key_col.attnum
                  ORDER BY key_col.ord
               ) = e.columns
               AND ref_ns.nspname = e.referenced_schema
               AND ref_tbl.relname = e.referenced_table
               AND ARRAY(
                 SELECT a.attname::text
                   FROM unnest(c.confkey) WITH ORDINALITY key_col(attnum, ord)
                   JOIN pg_attribute a
                     ON a.attrelid = ref_tbl.oid AND a.attnum = key_col.attnum
                  ORDER BY key_col.ord
               ) = e.referenced_columns)
           )
      )
        AND NOT (
          e.kind = 'unique'
          AND EXISTS (
            SELECT 1
              FROM pg_index i
              JOIN pg_class tbl ON tbl.oid = i.indrelid
              JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
              JOIN pg_class idx ON idx.oid = i.indexrelid
             WHERE tbl_ns.nspname = e.schema_name
               AND tbl.relname = e.table_name
               AND (e.constraint_name IS NULL OR idx.relname = e.constraint_name)
               AND i.indisunique AND i.indisvalid AND i.indislive
               AND i.indpred IS NULL AND i.indexprs IS NULL
               AND i.indnkeyatts = cardinality(e.columns)
               AND ARRAY(
                 SELECT a.attname::text
                   FROM unnest(i.indkey) WITH ORDINALITY key_col(attnum, ord)
                   JOIN pg_attribute a
                     ON a.attrelid = tbl.oid AND a.attnum = key_col.attnum
                  WHERE key_col.ord <= i.indnkeyatts
                  ORDER BY key_col.ord
               ) = e.columns
          )
        )
      ORDER BY e.schema_name, e.table_name, e.constraint_name`,
    [JSON.stringify(expectations)],
  )) as CriticalConstraintExpectation[];

  if (result.length > 0) {
    const details = result
      .map((constraint) => {
        const name = constraint.constraintName
          ? ` ${constraint.constraintName}`
          : '';
        const columns = constraint.columns.join(', ');
        const reference =
          constraint.kind === 'foreign'
            ? ` -> ${constraint.referencedSchema}.${constraint.referencedTable}(${constraint.referencedColumns?.join(', ')})`
            : '';
        return `- ${constraint.schemaName}.${constraint.tableName}${name} ` +
          `(${constraint.kind}: ${columns}${reference}); expected from migration ${constraint.migration}`;
      })
      .join('\n');

    throw new Error(
      `Database schema is missing ${result.length} critical constraint(s):\n${details}\n` +
        'Apply the listed migrations before starting the application.',
    );
  }
}

@Injectable()
class CriticalDatabaseConstraintsCheck implements OnApplicationBootstrap {
  constructor(
    @InjectDataSource() private readonly primaryDataSource: DataSource,
    @InjectDataSource('replica') private readonly replicaDataSource: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await validateCriticalDatabaseConstraints((sql, parameters) =>
      this.primaryDataSource.query(sql, parameters),
    );
    await validateCriticalDatabaseConstraints((sql, parameters) =>
      this.replicaDataSource.query(sql, parameters),
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
    CriticalDatabaseConstraintsCheck,
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
