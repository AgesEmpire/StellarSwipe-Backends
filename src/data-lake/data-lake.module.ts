import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { EtlOrchestratorService } from './etl/etl-orchestrator.service';
import { UserEventsExtractor } from './etl/extractors/user-events.extractor';
import { TradesExtractor } from './etl/extractors/trades.extractor';
import { SignalsExtractor } from './etl/extractors/signals.extractor';
import { PositionsExtractor } from './etl/extractors/positions.extractor';
import { ParquetTransformer } from './etl/transformers/parquet.transformer';
import { DataLakeLoader } from './etl/loaders/data-lake.loader';
import { EtlJob } from './entities/etl-job.entity';
import { ExportJob } from './entities/export-job.entity';
import { ExportJobService } from './export/export-job.service';
import { ExportJobController } from './export/export-job.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([EtlJob, ExportJob]),
    ScheduleModule.forRoot(),
  ],
  controllers: [ExportJobController],
  providers: [
    EtlOrchestratorService,
    UserEventsExtractor,
    TradesExtractor,
    SignalsExtractor,
    PositionsExtractor,
    ParquetTransformer,
    DataLakeLoader,
    ExportJobService,
  ],
  exports: [EtlOrchestratorService, ExportJobService],
})
export class DataLakeModule {}
