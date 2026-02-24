import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
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
import { UsersModule } from './users/users.module';
import { SignalsModule } from './signals/signals.module';
import { TradesModule } from './trades/trades.module';
import { ProvidersModule } from './providers/providers.module';
import { MlModule } from './ml/ml.module';
import { ValidationModule } from './common/validation/validation.module';
import { ScalingModule } from './scaling/scaling.module';
import { VersioningModule } from './common/modules/versioning.module';
import { ReferralsModule } from './referrals/referrals.module';
import { EventsModule } from './events/events.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { SecurityModule } from './security/security.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SecurityMonitoringModule } from './security/security-monitoring.module';

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
        // Connection Pool Configuration (min: 10, max: 30 for 10k+ users)
        extra: {
          min: parseInt(process.env.DATABASE_POOL_MIN || '10', 10),
          max: parseInt(process.env.DATABASE_POOL_MAX || '30', 10),
          idleTimeoutMillis: parseInt(
            process.env.DATABASE_POOL_IDLE_TIMEOUT || '30000',
            10,
          ),
          connectionTimeoutMillis: parseInt(
            process.env.DATABASE_POOL_CONNECTION_TIMEOUT || '2000',
            10,
          ),
        },
      }),
    }),

    EventEmitterModule.forRoot(),

    // DatabaseOptimizationModule,
    LoggerModule,
    SentryModule,
    UsersModule,
    SignalsModule,
    TradesModule,
    CacheModule,
    AuthModule,
    ProvidersModule,
    MlModule,
    ScalingModule,
    VersioningModule,
    ReferralsModule,
    EventsModule,
    ApiKeysModule,
    SecurityModule,
    SecurityMonitoringModule,
  ],
  providers: [StellarConfigService],
  exports: [StellarConfigService],
})
export class AppModule {}
