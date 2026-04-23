import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { QueryAnalyzerService } from './optimization/query-analyzer.service';
import { IndexManagerService } from './optimization/index-manager.service';
import { MaterializedViewService } from './optimization/materialized-view.service';
import { SignalPerformance } from '../signals/entities/signal-performance.entity';
import { ConnectionPoolMetricsService } from './connection-pool.metrics.service';
import { MonitoringModule } from '../monitoring/monitoring.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([SignalPerformance]),
    EventEmitterModule.forRoot(),
    MonitoringModule,
  ],
  providers: [
    QueryAnalyzerService,
    IndexManagerService,
    MaterializedViewService,
    ConnectionPoolMetricsService,
  ],
  exports: [
    QueryAnalyzerService,
    IndexManagerService,
    MaterializedViewService,
    ConnectionPoolMetricsService,
  ],
})
export class DatabaseOptimizationModule {}
