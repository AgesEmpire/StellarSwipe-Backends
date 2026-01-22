 feat/ai-signal-validation-integration
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bull";
import { Signal } from "./entities/signal.entity";
import { SignalsService } from "./signals.service";
import { SignalsController } from "./signals.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([Signal]),
    BullModule.registerQueue({
      name: "signal-validation",
    }),
  ],
  providers: [SignalsService],
  controllers: [SignalsController],
  exports: [SignalsService, TypeOrmModule],

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
 feat/signal-autoclose
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  Signal,
  CopiedPosition,
  UserExpirationPreference,
  ExpirationNotification,
} from './entities';
import {
  SignalExpirationService,
  ExpirationHandlerService,
  ExpirationNotificationService,
  EXPIRATION_QUEUE,
} from './services';
import { ProcessExpirationsJob } from './jobs';
import { SignalAutoCloseController } from './signal-autoclose.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Signal,
      CopiedPosition,
      UserExpirationPreference,
      ExpirationNotification,
    ]),
    BullModule.registerQueueAsync({
      name: EXPIRATION_QUEUE,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('redis.host') ?? 'localhost',
          port: configService.get<number>('redis.port') ?? 6379,
          password: configService.get<string>('redis.password'),
          db: configService.get<number>('redis.db') ?? 0,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      }),
    }),
  ],
  controllers: [SignalAutoCloseController],
  providers: [
    SignalExpirationService,
    ExpirationHandlerService,
    ExpirationNotificationService,
    ProcessExpirationsJob,
  ],
  exports: [
    SignalExpirationService,
    ExpirationHandlerService,
    ExpirationNotificationService,
  ],

 feat/signal-performance
import { BullModule } from '@nestjs/bull';
import { Signal } from './entities/signal.entity';
import { SignalPerformance } from './entities/signal-performance.entity';
import { ProviderStats } from './entities/provider-stats.entity';
import { SdexPriceService } from './services/sdex-price.service';
import { SignalPerformanceService } from './services/signal-performance.service';
import { ProviderStatsService } from './services/provider-stats.service';
import { TrackSignalOutcomesJob, SIGNAL_TRACKING_QUEUE } from './jobs/track-signal-outcomes.job';
import { SignalsController } from './signals.controller';
import { StellarConfigService } from '../config/stellar.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Signal, SignalPerformance, ProviderStats]),
    BullModule.registerQueue({
      name: SIGNAL_TRACKING_QUEUE,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    }),
  ],
  controllers: [SignalsController],
  providers: [
    StellarConfigService,
    SdexPriceService,
    SignalPerformanceService,
    ProviderStatsService,
    TrackSignalOutcomesJob,
  ],
  exports: [
    SignalPerformanceService,
    ProviderStatsService,
    SdexPriceService,
  ],

import { SignalsService } from './signals.service';
import { SignalsController } from './signals.controller';
import { Signal } from './entities/signal.entity';
import { SignalPerformance } from './entities/signal-performance.entity';
import { SignalInteraction } from './entities/signal-interaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Signal, SignalPerformance, SignalInteraction]),
  ],
  controllers: [SignalsController],
  providers: [SignalsService],
  exports: [SignalsService],
 main
 main
 main
})
export class SignalsModule {}
