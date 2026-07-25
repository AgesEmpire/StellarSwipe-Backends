import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformTrustline, TrustlineStatus } from '../entities/platform-trustline.entity';

@Injectable()
export class OrphanedTrustlineScanJob {
  private readonly logger = new Logger(OrphanedTrustlineScanJob.name);

  constructor(
    @InjectRepository(PlatformTrustline)
    private readonly trustlineRepo: Repository<PlatformTrustline>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async scan(): Promise<{ flagged: number }> {
    this.logger.log('Starting orphaned trustline scan');

    // Find trustlines whose associated asset is no longer active,
    // but that have not yet been flagged.
    const orphaned = await this.trustlineRepo
      .createQueryBuilder('tl')
      .innerJoinAndSelect('tl.asset', 'asset')
      .where('asset.isActive = false')
      .andWhere('tl.status != :status', { status: TrustlineStatus.ORPHANED })
      .getMany();

    if (orphaned.length === 0) {
      this.logger.debug('No orphaned trustlines detected');
      return { flagged: 0 };
    }

    const now = new Date();
    for (const trustline of orphaned) {
      trustline.status = TrustlineStatus.ORPHANED;
      trustline.flaggedAt = now;
    }

    await this.trustlineRepo.save(orphaned);

    this.logger.warn(
      `Flagged ${orphaned.length} orphaned trustline(s) for admin review`,
    );

    return { flagged: orphaned.length };
  }

  async getOrphanedTrustlines(): Promise<PlatformTrustline[]> {
    return this.trustlineRepo
      .createQueryBuilder('tl')
      .innerJoinAndSelect('tl.asset', 'asset')
      .where('tl.status = :status', { status: TrustlineStatus.ORPHANED })
      .orderBy('tl.flaggedAt', 'DESC')
      .getMany();
  }
}
