import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { EtlOrchestratorService } from './etl/etl-orchestrator.service';
import { UserEventsExtractor } from './etl/extractors/user-events.extractor';
import { TradesExtractor } from './etl/extractors/trades.extractor';
import { SignalsExtractor } from './etl/extractors/signals.extractor';
import { ParquetTransformer } from './etl/transformers/parquet.transformer';
import { DataLakeLoader } from './etl/loaders/data-lake.loader';
import { EtlJob } from './entities/etl-job.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([EtlJob]),
    ScheduleModule.forRoot(),
  ],
  providers: [
    EtlOrchestratorService,
    UserEventsExtractor,
    TradesExtractor,
    SignalsExtractor,
    ParquetTransformer,
    DataLakeLoader,
  ],
  exports: [EtlOrchestratorService],
})
export class DataLakeModule {}
