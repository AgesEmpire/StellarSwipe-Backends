import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { stellarConfig } from './config/stellar.config';
import { databaseConfig, redisConfig } from './config/database.config';
import { xaiConfig } from './config/xai.config';
import { appConfig, sentryConfig } from './config/app.config';
import { jwtConfig } from './config/jwt.config';
import { StellarConfigService } from './config/stellar.service';
import { LoggerModule } from './common/logger';
import { SentryModule } from './common/sentry';
import { BetaModule } from './beta/beta.module';
import { TradesModule } from './trades/trades.module';
import { RiskManagerModule } from './risk/risk-manager.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { SignalsModule } from './signals/signals.module';
import { UsersModule } from './users/users.module';
import { configSchema } from './config/schemas/config.schema';
import configuration from './config/configuration';
import { HealthModule } from './health/health.module';
import { CacheModule } from './cache/cache.module';
import { redisCacheConfig } from './config/redis.config';
import { SorobanModule } from './soroban/soroban.module';

@Module({
  imports: [
    // Configuration Module - loads environment variables with validation
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
        configuration,
      ],
      envFilePath: [
        `.env.${process.env.NODE_ENV || 'development'}`,
        '.env',
      ],
      cache: true,
      validationSchema: configSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    // Bull Module for async processing
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
    // Logger Module - Winston-based structured logging
    LoggerModule,
    // Sentry Module - Error tracking
    SentryModule,
    // Database Module
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
      }),
    }),
    // Feature Modules
    UsersModule,
    SignalsModule,
    BetaModule,
    TradesModule,
    RiskManagerModule,
    PortfolioModule,
    HealthModule,
    // Cache Module - Redis-based caching for sessions and data
    CacheModule,
    SorobanModule,
  ],
  providers: [StellarConfigService],
  exports: [StellarConfigService],
})
export class AppModule { }
