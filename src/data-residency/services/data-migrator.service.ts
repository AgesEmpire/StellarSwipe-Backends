import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { RegionCode } from '../entities/data-region.entity';
import { DataLocalizer, LocalizationResult } from '../utils/data-localizer';
import { RegionRouterService } from './region-router.service';
import { ComplianceValidatorService } from './compliance-validator.service';

export interface MigrationJob {
  jobId: string;
  userId: string;
  sourceRegion: RegionCode;
  targetRegion: RegionCode;
  status: MigrationStatus;
  startedAt: Date;
  completedAt?: Date;
  result?: LocalizationResult;
  error?: string;
}

export enum MigrationStatus {
  QUEUED = 'queued',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ROLLED_BACK = 'rolled_back',
}

@Injectable()
export class DataMigratorService {
  private readonly logger = new Logger(DataMigratorService.name);
  private readonly activeJobs = new Map<string, MigrationJob>();

  constructor(
    private readonly dataLocalizer: DataLocalizer,
    private readonly regionRouter: RegionRouterService,
    private readonly complianceValidator: ComplianceValidatorService,
  ) {}

  async scheduleMigration(
    userId: string,
    sourceRegion: RegionCode,
    targetRegion: RegionCode,
    reason?: string,
  ): Promise<MigrationJob> {
    if (sourceRegion === targetRegion) {
      throw new BadRequestException('Source and target regions must differ');
    }

    const complianceOk = await this.complianceValidator.isMigrationAllowed(
      userId,
      sourceRegion,
      targetRegion,
    );
    if (!complianceOk) {
      throw new BadRequestException(
        `Data migration from ${sourceRegion} to ${targetRegion} is not allowed by compliance policy`,
      );
    }

    const jobId = this.generateJobId(userId, sourceRegion, targetRegion);
    const job: MigrationJob = {
      jobId,
      userId,
      sourceRegion,
      targetRegion,
      status: MigrationStatus.QUEUED,
      startedAt: new Date(),
    };

    this.activeJobs.set(jobId, job);
    this.logger.log(
      `Migration job ${jobId} queued: ${sourceRegion} → ${targetRegion} for user ${userId}` +
      (reason ? ` (reason: ${reason})` : ''),
    );

    // Execute asynchronously so the caller gets the job reference immediately
    this.executeMigration(job).catch((err) => {
      this.logger.error(`Migration job ${jobId} failed unexpectedly`, err);
    });

    return job;
  }

  async executeMigration(job: MigrationJob): Promise<void> {
    job.status = MigrationStatus.IN_PROGRESS;
    this.logger.log(`Migration job ${job.jobId} started`);

    try {
      const dataKeys = await this.resolveUserDataKeys(job.userId, job.sourceRegion);

      const result = await this.dataLocalizer.localizeUserData(
        job.userId,
        job.sourceRegion,
        job.targetRegion,
        dataKeys,
        { encryptBeforeTransfer: true, deleteSourceAfterTransfer: true },
      );

      job.result = result;
      job.completedAt = new Date();

      if (result.success) {
        job.status = MigrationStatus.COMPLETED;
        this.logger.log(`Migration job ${job.jobId} completed successfully`);
      } else {
        job.status = MigrationStatus.FAILED;
        job.error = result.errors.join('; ');
        this.logger.error(`Migration job ${job.jobId} failed: ${job.error}`);
      }
    } catch (error) {
      job.status = MigrationStatus.FAILED;
      job.error = error instanceof Error ? error.message : String(error);
      job.completedAt = new Date();
      this.logger.error(`Migration job ${job.jobId} threw: ${job.error}`);
    }
  }

  getJob(jobId: string): MigrationJob | undefined {
    return this.activeJobs.get(jobId);
  }

  getJobsForUser(userId: string): MigrationJob[] {
    return Array.from(this.activeJobs.values()).filter((j) => j.userId === userId);
  }

  private async resolveUserDataKeys(
    userId: string,
    region: RegionCode,
  ): Promise<string[]> {
    // Returns all storage keys belonging to userId in region.
    // In production this queries the storage index or user profile service.
    const dataTypes = ['profile', 'transactions', 'preferences', 'kyc'];
    return dataTypes.map((t) =>
      this.dataLocalizer.buildStorageKey(userId, region, t),
    );
  }

  private generateJobId(
    userId: string,
    source: RegionCode,
    target: RegionCode,
  ): string {
    return `${userId}-${source}-${target}-${Date.now()}`;
  }
}
