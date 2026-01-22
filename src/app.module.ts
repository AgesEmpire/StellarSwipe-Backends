import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { stellarConfig } from './config/stellar.config';
import { databaseConfig, redisConfig } from './config/database.config';
import { appConfig, sentryConfig } from './config/app.config';
import { jwtConfig } from './config/jwt.config';
import { StellarConfigService } from './config/stellar.service';
import { LoggerModule } from './common/logger';
import { SentryModule } from './common/sentry';
import { BetaModule } from './beta/beta.module';
import { TradesModule } from './trades/trades.module';
import { RiskManagerModule } from './risk/risk-manager.module';
import { PortfolioModule } from './portfolio/portfolio.module';
 feat/signal-performance

import { UsersModule } from './users/users.module';
 main
import { SignalsModule } from './signals/signals.module';
import { configSchema } from './config/schemas/config.schema';
import configuration from './config/configuration';
import { HealthModule } from './health/health.module';

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
        jwtConfig,
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
 feat/signal-performance
      }),
    }),
    // Bull Queue Module for background jobs
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('redis.host'),
          port: configService.get<number>('redis.port'),
          password: configService.get<string>('redis.password'),
          db: configService.get<number>('redis.db'),
        },
 main
      }),
    }),
    // Feature Modules
    UsersModule,
    SignalsModule,
    BetaModule,
    TradesModule,
    RiskManagerModule,
    PortfolioModule,
 feat/signal-performance
    SignalsModule,

    HealthModule,
 main
  ],
  providers: [StellarConfigService],
  exports: [StellarConfigService],
})
export class AppModule { }
