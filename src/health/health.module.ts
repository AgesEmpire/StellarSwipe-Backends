import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bull';
import { HealthController } from './health.controller';
import {
  StellarHealthIndicator,
  SorobanHealthIndicator,
  DatabaseHealthIndicator,
  RedisHealthIndicator,
  QueueHealthIndicator,
  KafkaHealthIndicator,
} from './indicators';
import { StellarConfigService } from '../config/stellar.service';
import { HealthSummaryService } from './health-summary.service';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { SyntheticMonitoringService } from './synthetic-monitoring.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Signal } from '../signals/entities/signal.entity';
import { Trade } from '../trades/entities/trade.entity';
import { StreamingModule } from '../streaming/streaming.module';

@Module({
  imports: [
    TerminusModule,
    MonitoringModule,
    BullModule.registerQueue({ name: 'priority-queue' }),
    TypeOrmModule.forFeature([User, Signal, Trade]),
    StreamingModule,
  ],
  controllers: [HealthController],
  providers: [
    StellarConfigService,
    StellarHealthIndicator,
    SorobanHealthIndicator,
    DatabaseHealthIndicator,
    RedisHealthIndicator,
    QueueHealthIndicator,
    KafkaHealthIndicator,
    HealthSummaryService,
    SyntheticMonitoringService,
  ],
  exports: [
    StellarHealthIndicator,
    SorobanHealthIndicator,
    DatabaseHealthIndicator,
    RedisHealthIndicator,
    QueueHealthIndicator,
    KafkaHealthIndicator,
    HealthSummaryService,
    SyntheticMonitoringService,
  ],
})
export class HealthModule {}
