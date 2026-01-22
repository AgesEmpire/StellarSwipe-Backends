import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
})
export class SignalsModule {}
