import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { QueryAnalyzerService } from './optimization/query-analyzer.service';
import { IndexManagerService } from './optimization/index-manager.service';
import { MaterializedViewService } from './optimization/materialized-view.service';
import { SignalPerformance } from '../signals/entities/signal-performance.entity';
import { ConnectionPoolMetricsService } from './connection-pool.metrics.service';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { SchemaVersioningService } from './schema-versioning.service';
import { SchemaVersion } from './schema-version.entity';
import { QueryMonitorService } from './query-monitor.service';
import { MigrationRunnerService } from './migration-runner.service';
import { MigrationRunnerController } from './migration-runner.controller';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([SignalPerformance, SchemaVersion]),
    EventEmitterModule.forRoot(),
    MonitoringModule,
  ],
  controllers: [MigrationRunnerController],
  providers: [
    QueryAnalyzerService,
    IndexManagerService,
    MaterializedViewService,
    ConnectionPoolMetricsService,
    SchemaVersioningService,
    QueryMonitorService,
    MigrationRunnerService,
  ],
  exports: [
    QueryAnalyzerService,
    IndexManagerService,
    MaterializedViewService,
    ConnectionPoolMetricsService,
    SchemaVersioningService,
    QueryMonitorService,
    MigrationRunnerService,
  ],
})
export class DatabaseOptimizationModule {}
