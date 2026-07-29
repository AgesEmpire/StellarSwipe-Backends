import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../users/entities/user.entity';
import { AmlMonitoringService } from '../aml-monitoring.service';

export const AML_QUEUE = 'aml';
export const AML_SCAN_JOB = 'aml-scan';
export const AML_SAR_JOB = 'aml-auto-sar';

@Injectable()
@Processor(AML_QUEUE)
export class AmlScanJob implements OnModuleInit {
  private readonly logger = new Logger(AmlScanJob.name);

  constructor(
    @InjectQueue(AML_QUEUE) private readonly amlQueue: Queue,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly amlMonitoringService: AmlMonitoringService,
  ) {}

  async onModuleInit() {
    await this.registerRepeatableJobs();
  }

  private async registerRepeatableJobs() {
    const existing = await this.amlQueue.getRepeatableJobs();

    // ── Hourly user scan ──────────────────────────────────────────────────────
    if (!existing.find((j) => j.id === AML_SCAN_JOB)) {
      await this.amlQueue.add(
        AML_SCAN_JOB,
        {},
        {
          priority: 1000, // LOW — background analytics processing
          jobId: AML_SCAN_JOB,
          repeat: { cron: '0 * * * *' }, // every hour on the hour
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log('Registered repeatable AML scan job (hourly)');
    }

    // ── Daily auto-SAR filing ─────────────────────────────────────────────────
    if (!existing.find((j) => j.id === AML_SAR_JOB)) {
      await this.amlQueue.add(
        AML_SAR_JOB,
        { riskScoreThreshold: 80 },
        {
          priority: 1000, // LOW — background analytics processing
          jobId: AML_SAR_JOB,
          repeat: { cron: '0 9 * * *' }, // 09:00 UTC daily
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log('Registered repeatable auto-SAR job (daily 09:00 UTC)');
    }
  }

  // ─── Processors ─────────────────────────────────────────────────────────────

  /**
   * Hourly job: scan every active user for suspicious patterns.
   * Processes users in batches to avoid memory pressure.
   */
  @Process(AML_SCAN_JOB)
  async handleScan(job: Job) {
    this.logger.log('AML batch scan started');
    const batchSize = 100;
    let offset = 0;
    let totalFlagged = 0;

    while (true) {
      const users = await this.userRepo.find({
        where: { isActive: true },
        select: ['id'],
        take: batchSize,
        skip: offset,
      });

      if (users.length === 0) break;

      await Promise.allSettled(
        users.map(async (user) => {
          try {
            const summary = await this.amlMonitoringService.scanUser(user.id);
            if (summary.activitiesCreated > 0) {
              totalFlagged += summary.activitiesCreated;
              this.logger.warn(
                `AML flags created: userId=${user.id} count=${summary.activitiesCreated} maxScore=${summary.highestRiskScore}`,
              );
            }
          } catch (err) {
            this.logger.error(
              `AML scan error for user ${user.id}: ${(err as Error).message}`,
            );
          }
        }),
      );

      offset += batchSize;
    }

    this.logger.log(`AML scan complete — ${totalFlagged} new flags created`);
    return { totalFlagged };
  }

  /**
   * Daily job: automatically file SARs for high-risk open flags.
   */
  @Process(AML_SAR_JOB)
  async handleAutoSar(job: Job<{ riskScoreThreshold: number }>) {
    const threshold = job.data.riskScoreThreshold ?? 80;
    this.logger.log(`Auto-SAR filing started (threshold: ${threshold})`);

    const reports =
      await this.amlMonitoringService.autoFileSarsAboveThreshold(threshold);

    this.logger.log(`Auto-SAR filing complete — ${reports.length} SARs filed`);
    return { sarsFiled: reports.length };
  }
}
