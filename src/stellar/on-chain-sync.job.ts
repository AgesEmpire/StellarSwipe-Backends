import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnChainSyncService } from './on-chain-sync.service';

@Injectable()
export class OnChainSyncJob {
  private readonly logger = new Logger(OnChainSyncJob.name);

  constructor(private readonly syncService: OnChainSyncService) {}

  /** Poll every 10 seconds — well within Stellar's ~5 s ledger close time */
  @Cron('*/10 * * * * *')
  async run(): Promise<void> {
    const count = await this.syncService.syncLatestEvents();
    if (count > 0) {
      this.logger.log(`Synced ${count} on-chain event(s)`);
    }
  }
}
