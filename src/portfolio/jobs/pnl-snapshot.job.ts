import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PnlSnapshotService } from '../services/pnl-snapshot.service';

@Injectable()
export class PnlSnapshotJob {
  private readonly logger = new Logger(PnlSnapshotJob.name);

  constructor(private readonly pnlSnapshotService: PnlSnapshotService) {}

  @Cron('0 * * * *', { name: 'portfolio-pnl-hourly-snapshot', timeZone: 'UTC' })
  async handleHourlySnapshot(): Promise<void> {
    this.logger.debug('Starting hourly portfolio P&L snapshot job');
    await this.pnlSnapshotService.runHourlySnapshot();
  }
}
