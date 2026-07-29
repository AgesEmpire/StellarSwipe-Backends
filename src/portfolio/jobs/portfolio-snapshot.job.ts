import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PortfolioSnapshotService } from '../services/portfolio-snapshot.service';

@Injectable()
export class PortfolioSnapshotJob {
  private readonly logger = new Logger(PortfolioSnapshotJob.name);

  constructor(private readonly portfolioSnapshotService: PortfolioSnapshotService) {}

  @Cron(process.env.PORTFOLIO_PNL_SNAPSHOT_CRON ?? CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleNightlySnapshot(): Promise<void> {
    this.logger.log('Starting nightly portfolio P&L snapshot job');
    await this.portfolioSnapshotService.refreshSnapshotsForAllUsers();
    this.logger.log('Completed nightly portfolio P&L snapshot job');
  }
}
