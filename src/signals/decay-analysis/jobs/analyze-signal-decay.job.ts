import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DecayAnalyzerService } from '../decay-analyzer.service';
import { SignalPerformanceService } from '../../services/signal-performance.service';
import { SdexPriceService } from '../../services/sdex-price.service';
import { SignalStatus } from '../../entities/signal.entity';

@Injectable()
export class AnalyzeSignalDecayJob {
  private readonly logger = new Logger(AnalyzeSignalDecayJob.name);

  constructor(
    private readonly decayAnalyzerService: DecayAnalyzerService,
    private readonly performanceService: SignalPerformanceService,
    private readonly sdexPriceService: SdexPriceService,
  ) {}

  /**
   * Main cron job that runs every hour to track signal performance and analyze decay.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleDecayAnalysis() {
    this.logger.log('Starting scheduled signal decay analysis task...');

    try {
      // 1. Refresh statuses of existing analyzed signals
      const { updated } = await this.decayAnalyzerService.refreshDecayStatuses();
      if (updated > 0) {
        this.logger.log(`Refreshed ${updated} signal decay status(es).`);
      }

      // 2. Sample accuracy for all active signals
      const activeSignals = await this.performanceService.getActiveSignals();
      this.logger.debug(`Sampling accuracy for ${activeSignals.length} active signals.`);
      
      for (const signal of activeSignals) {
        await this.sampleSignalAccuracy(signal);
      }
    } catch (error) {
      this.logger.error(`Decay analysis job failed: ${error.message}`);
    }
  }

  private async sampleSignalAccuracy(signal: any) {
    try {
      const priceResult = await this.sdexPriceService.getPrice(signal.baseAsset, signal.counterAsset);
      if (!priceResult.available) return;

      const currentPrice = priceResult.price;
      const accuracy = this.computeProximityAccuracy(signal, currentPrice);
      const hoursElapsed = (Date.now() - signal.createdAt.getTime()) / (1000 * 60 * 60);

      const metadata = signal.metadata || {};
      if (!metadata.performanceSnapshots) {
        metadata.performanceSnapshots = [];
      }

      metadata.performanceSnapshots.push({
        hoursElapsed: Math.round(hoursElapsed * 100) / 100,
        accuracy: Math.round(accuracy * 10000) / 10000,
        sampledAt: new Date(),
      });

      // Maintain a reasonable history size
      if (metadata.performanceSnapshots.length > 168) { // 1 week of hourly data
        metadata.performanceSnapshots.shift();
      }

      await this.performanceService.updateSignal(signal.id, { metadata });
    } catch (error) {
      this.logger.warn(`Failed to sample accuracy for signal ${signal.id}: ${error.message}`);
    }
  }

  private computeProximityAccuracy(signal: any, currentPrice: string): number {
    const entry = parseFloat(signal.entryPrice);
    const target = parseFloat(signal.targetPrice);
    const current = parseFloat(currentPrice);

    const totalMove = Math.abs(target - entry);
    if (totalMove < 0.00000001) return 0;

    const currentMove = Math.abs(current - entry);
    
    // Simple accuracy: progress towards target
    const accuracy = currentMove / totalMove;
    return Math.max(0, Math.min(1, accuracy));
  }
}
