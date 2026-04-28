import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Signal } from './entities/signal.entity';
import { CopiedPosition } from './entities/copied-position.entity';
import { SignalsService } from './signals.service';
import { SignalsController } from './signals.controller';
import {
  SignalVersion,
  SignalVersionApproval,
} from './versions/entities/signal-version.entity';
import { SignalVersionService } from './versions/signal-version.service';
import { SignalVersionController } from './versions/signal-version.controller';
import { SignalDecay } from './decay-analysis/entities/signal-decay.entity';
import { DecayAnalyzerService } from './decay-analysis/decay-analyzer.service';
import { SignalPerformanceService } from './services/signal-performance.service';
import { SdexPriceService } from './services/sdex-price.service';
import { SignalPerformance } from './entities/signal-performance.entity';
import { AnalyzeSignalDecayJob } from './decay-analysis/jobs/analyze-signal-decay.job';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Signal,
      CopiedPosition,
      SignalVersion,
      SignalVersionApproval,
      SignalDecay,
      SignalPerformance,
    ]),
    CacheModule,
    BullModule.registerQueueAsync({
      name: 'signal-tracking',
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
  providers: [
    SignalsService,
    SignalVersionService,
    DecayAnalyzerService,
    SignalPerformanceService,
    SdexPriceService,
    AnalyzeSignalDecayJob,
  ],
  controllers: [SignalsController, SignalVersionController],
  exports: [
    SignalsService,
    SignalVersionService,
    DecayAnalyzerService,
    SignalPerformanceService,
    SdexPriceService,
    TypeOrmModule,
  ],
})
export class SignalsModule {}
