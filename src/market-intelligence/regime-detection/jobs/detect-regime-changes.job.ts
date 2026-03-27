import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RegimeDetectorService } from '../regime-detector.service';

@Injectable()
export class DetectRegimeChangesJob {
  private readonly logger = new Logger(DetectRegimeChangesJob.name);
  private readonly MONITORED_PAIRS = ['XLM-USDC', 'BTC-USDC', 'ETH-USDC'];

  constructor(private readonly regimeDetectorService: RegimeDetectorService) {}

  @Cron(CronExpression.EVERY_4_HOURS)
  async handleRegimeDetection() {
    this.logger.log('Starting scheduled market regime detection job');

    for (const assetPair of this.MONITORED_PAIRS) {
      try {
        const regime = await this.regimeDetectorService.detectRegime({ assetPair });
        this.logger.log(`Update: Market for ${assetPair} is in ${regime.type} regime`);
      } catch (error) {
        this.logger.error(`Failed to detect regime for ${assetPair}: ${error.message}`);
      }
    }

    this.logger.log('Market regime detection job completed');
  }
}
