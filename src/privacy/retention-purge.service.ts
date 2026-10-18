import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { ConfigService } from '@nestjs/config';

/**
 * Report produced by a retention purge run.
 *
 * In dry-run mode no mutation happens: `purgedCount` is always 0 and
 * `eligibleIdentifiers` lets operators see exactly which records would be
 * affected, with identifiers masked so the report itself never leaks raw PII.
 */
export interface PurgeReport {
  dryRun: boolean;
  cutoff: Date;
  daysThreshold: number;
  eligibleCount: number;
  eligibleIdentifiers: string[];
  purgedCount: number;
}

interface PurgeOptions {
  dryRun: boolean;
  daysThreshold?: number;
}

@Injectable()
export class RetentionPurgeService {
  private readonly logger = new Logger(RetentionPurgeService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDailyPurge(): Promise<void> {
    this.logger.log('Starting retention purge job');
    try {
      const report = await this.purge({ dryRun: false });
      this.logger.log(`Retention purge completed. Records purged: ${report.purgedCount}`);
    } catch (error) {
      this.logger.error('Retention purge failed', error);
    }
  }

  /**
   * Preview records eligible for retention purge without mutating any data.
   * Intended for operators to sanity-check a purge before it runs for real.
   * Sensitive fields are never included; identifiers are masked.
   */
  async previewPurge(daysThreshold?: number): Promise<PurgeReport> {
    return this.purge({ dryRun: true, daysThreshold });
  }

  // Exposed for tests / manual run
  async purgeNowForTesting(daysThreshold = this.config.get<number>('retention.deletedUserDays') ?? 30) {
    const report = await this.purge({ dryRun: false, daysThreshold });
    return report.purgedCount;
  }

  private async purge(options: PurgeOptions): Promise<PurgeReport> {
    const daysThreshold =
      options.daysThreshold ?? this.config.get<number>('retention.deletedUserDays') ?? 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysThreshold);

    const users = await this.userRepo.find();
    const eligible = users.filter((u) => u.deletedAt && u.deletedAt < cutoff);

    const report: PurgeReport = {
      dryRun: options.dryRun,
      cutoff,
      daysThreshold,
      eligibleCount: eligible.length,
      eligibleIdentifiers: eligible.map((u) => this.maskIdentifier(u.id)),
      purgedCount: 0,
    };

    if (options.dryRun) {
      this.logger.log(
        `Dry-run retention purge: ${eligible.length} record(s) eligible for purge (cutoff ${cutoff.toISOString()})`,
      );
      return report;
    }

    for (const user of eligible) {
      // Anonymize PII fields but keep row for aggregates
      user.email = null;
      user.displayName = null;
      user.bio = null;
      await this.userRepo.save(user);
      report.purgedCount += 1;
    }

    return report;
  }

  /**
   * Masks an identifier so dry-run reports never expose enough of a raw id
   * (or any other sensitive data) to be useful outside of this system.
   */
  private maskIdentifier(id: string): string {
    if (!id || id.length <= 8) {
      return '***';
    }
    return `${id.slice(0, 4)}...${id.slice(-4)}`;
  }
}
