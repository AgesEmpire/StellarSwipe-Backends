import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEventsExtractor } from './extractors/user-events.extractor';
import { TradesExtractor } from './extractors/trades.extractor';
import { SignalsExtractor } from './extractors/signals.extractor';
import { BaseExtractor } from './extractors/base.extractor';
import { ParquetTransformer } from './transformers/parquet.transformer';
import { DataLakeLoader, RetentionPolicy } from './loaders/data-lake.loader';
import { EtlJob, EtlJobStatus, EtlJobType } from '../entities/etl-job.entity';

export interface EtlPipelineResult {
  jobId: string;
  jobType: EtlJobType;
  status: EtlJobStatus;
  recordsProcessed: number;
  partitionPath: string;
  durationMs: number;
}

@Injectable()
export class EtlOrchestratorService {
  private readonly logger = new Logger(EtlOrchestratorService.name);

  private readonly retentionPolicies: RetentionPolicy[] = [
    { sourceName: 'user_events', retentionDays: 365 },
    { sourceName: 'trades', retentionDays: 730 },
    { sourceName: 'signals', retentionDays: 365 },
  ];

  private readonly extractors: Map<EtlJobType, BaseExtractor>;

  constructor(
    private readonly userEventsExtractor: UserEventsExtractor,
    private readonly tradesExtractor: TradesExtractor,
    private readonly signalsExtractor: SignalsExtractor,
    private readonly parquetTransformer: ParquetTransformer,
    private readonly dataLakeLoader: DataLakeLoader,
    @InjectRepository(EtlJob)
    private readonly etlJobRepository: Repository<EtlJob>,
  ) {
    this.extractors = new Map<EtlJobType, BaseExtractor>([
      [EtlJobType.USER_EVENTS, this.userEventsExtractor],
      [EtlJobType.TRADES, this.tradesExtractor],
      [EtlJobType.SIGNALS, this.signalsExtractor],
    ]);
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async runDailyEtl(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    this.logger.log(
      `Running daily ETL for ${yesterday.toISOString().split('T')[0]}`,
    );

    await Promise.all([
      this.runEtlPipeline(EtlJobType.USER_EVENTS, yesterday, endOfYesterday),
      this.runEtlPipeline(EtlJobType.TRADES, yesterday, endOfYesterday),
      this.runEtlPipeline(EtlJobType.SIGNALS, yesterday, endOfYesterday),
    ]);

    await this.runRetentionCleanup();
  }

  async runEtlPipeline(
    jobType: EtlJobType,
    startDate: Date,
    endDate: Date,
  ): Promise<EtlPipelineResult> {
    const startTime = Date.now();
    const job = this.etlJobRepository.create({
      jobType,
      status: EtlJobStatus.RUNNING,
      startDate,
      endDate,
    });
    await this.etlJobRepository.save(job);

    try {
      const extractor = this.extractors.get(jobType);
      if (!extractor) {
        throw new NotFoundException(`No extractor found for job type: ${jobType}`);
      }

      const records = await extractor.extract({
        startDate,
        endDate,
        batchSize: 10000,
      });

      const parquetRecord = this.parquetTransformer.transform(
        extractor.sourceName,
        records,
        startDate,
      );

      const loadResult = await this.dataLakeLoader.load(parquetRecord);

      job.status = EtlJobStatus.COMPLETED;
      job.recordsProcessed = records.length;
      job.partitionPath = loadResult.partitionKey;
      await this.etlJobRepository.save(job);

      const durationMs = Date.now() - startTime;
      this.logger.log(
        `ETL job ${job.id} completed: ${records.length} records in ${durationMs}ms`,
      );

      return {
        jobId: job.id,
        jobType,
        status: EtlJobStatus.COMPLETED,
        recordsProcessed: records.length,
        partitionPath: loadResult.partitionKey,
        durationMs,
      };
    } catch (error) {
      job.status = EtlJobStatus.FAILED;
      job.errorMessage = (error as Error).message;
      await this.etlJobRepository.save(job);

      this.logger.error(`ETL job ${job.id} failed: ${(error as Error).message}`);
      throw error;
    }
  }

  async runRetentionCleanup(): Promise<Record<string, number>> {
    const results: Record<string, number> = {};

    for (const policy of this.retentionPolicies) {
      const deletedPartitions =
        await this.dataLakeLoader.applyRetentionPolicy(policy);
      results[policy.sourceName] = deletedPartitions;
      this.logger.log(
        `Retention cleanup for ${policy.sourceName}: ${deletedPartitions} partitions removed`,
      );
    }

    return results;
  }

  async getJobHistory(limit = 50): Promise<EtlJob[]> {
    return this.etlJobRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getJobById(id: string): Promise<EtlJob> {
    const job = await this.etlJobRepository.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException(`ETL job with id ${id} not found`);
    }
    return job;
  }
}
