import { Processor, Process, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { SignalPerformanceService } from '../services/signal-performance.service';
import { ProviderStatsService } from '../services/provider-stats.service';
import { SdexPriceService } from '../services/sdex-price.service';
import { SignalOutcome } from '../entities/signal.entity';

export const SIGNAL_TRACKING_QUEUE = 'signal-tracking';

export interface TrackSignalJobData {
  signalId: string;
}

export interface TrackAllSignalsJobData {
  batchSize?: number;
}

@Processor(SIGNAL_TRACKING_QUEUE)
export class TrackSignalOutcomesJob {
  private readonly logger = new Logger(TrackSignalOutcomesJob.name);

  constructor(
    private signalPerformanceService: SignalPerformanceService,
    private providerStatsService: ProviderStatsService,
    private sdexPriceService: SdexPriceService,
  ) {}

  @Process('track-single-signal')
  async trackSingleSignal(job: Job<TrackSignalJobData>): Promise<void> {
    const { signalId } = job.data;

    this.logger.debug(`Processing signal tracking for: ${signalId}`);

    try {
      await this.signalPerformanceService.recordPerformance(signalId);

      const { signal, outcome, shouldClose } =
        await this.signalPerformanceService.checkSignalOutcome(signalId);

      if (shouldClose) {
        const priceResult = await this.sdexPriceService.getPrice(
          signal.baseAsset,
          signal.counterAsset,
        );

        const closePrice = priceResult.available
          ? priceResult.price
          : signal.currentPrice || signal.entryPrice;

        await this.signalPerformanceService.closeSignal(
          signalId,
          outcome,
          closePrice,
        );

        const pnlPercentage = this.sdexPriceService.calculatePnlPercentage(
          signal.entryPrice,
          closePrice,
        );

        const holdTimeSeconds = signal.closedAt
          ? Math.floor(
              (signal.closedAt.getTime() - signal.createdAt.getTime()) / 1000,
            )
          : Math.floor((Date.now() - signal.createdAt.getTime()) / 1000);

        await this.providerStatsService.onSignalClosed(
          signal.providerId,
          outcome,
          pnlPercentage,
          holdTimeSeconds,
          signal.copiersCount,
          signal.totalCopiedVolume,
        );

        this.logger.log(
          `Signal ${signalId} closed with outcome: ${outcome}, PnL: ${pnlPercentage}%`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error tracking signal ${signalId}: ${error}`,
      );
      throw error;
    }
  }

  @Process('track-all-signals')
  async trackAllSignals(job: Job<TrackAllSignalsJobData>): Promise<{
    processed: number;
    closed: number;
    errors: number;
  }> {
    const batchSize = job.data.batchSize || 50;

    this.logger.log('Starting batch signal tracking...');

    const activeSignals = await this.signalPerformanceService.getActiveSignals();

    let processed = 0;
    let closed = 0;
    let errors = 0;

    const batches = this.chunkArray(activeSignals, batchSize);

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(async (signal) => {
          try {
            await this.signalPerformanceService.recordPerformance(signal.id);

            const { outcome, shouldClose } =
              await this.signalPerformanceService.checkSignalOutcome(signal.id);

            if (shouldClose) {
              const priceResult = await this.sdexPriceService.getPrice(
                signal.baseAsset,
                signal.counterAsset,
              );

              const closePrice = priceResult.available
                ? priceResult.price
                : signal.currentPrice || signal.entryPrice;

              await this.signalPerformanceService.closeSignal(
                signal.id,
                outcome,
                closePrice,
              );

              const pnlPercentage = this.sdexPriceService.calculatePnlPercentage(
                signal.entryPrice,
                closePrice,
              );

              const holdTimeSeconds = Math.floor(
                (Date.now() - signal.createdAt.getTime()) / 1000,
              );

              await this.providerStatsService.onSignalClosed(
                signal.providerId,
                outcome,
                pnlPercentage,
                holdTimeSeconds,
                signal.copiersCount,
                signal.totalCopiedVolume,
              );

              return { closed: true };
            }

            return { closed: false };
          } catch (error) {
            this.logger.error(`Error processing signal ${signal.id}: ${error}`);
            throw error;
          }
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          processed++;
          if (result.value.closed) {
            closed++;
          }
        } else {
          errors++;
        }
      }

      await this.delay(100);
    }

    this.logger.log(
      `Batch tracking complete: ${processed} processed, ${closed} closed, ${errors} errors`,
    );

    return { processed, closed, errors };
  }

  @Process('cleanup-expired-signals')
  async cleanupExpiredSignals(): Promise<{ expired: number }> {
    this.logger.log('Cleaning up expired signals...');

    const expiredSignals = await this.signalPerformanceService.getExpiredSignals();

    let expiredCount = 0;

    for (const signal of expiredSignals) {
      try {
        const priceResult = await this.sdexPriceService.getPrice(
          signal.baseAsset,
          signal.counterAsset,
        );

        const closePrice = priceResult.available
          ? priceResult.price
          : signal.currentPrice || signal.entryPrice;

        await this.signalPerformanceService.closeSignal(
          signal.id,
          SignalOutcome.EXPIRED,
          closePrice,
        );

        const pnlPercentage = this.sdexPriceService.calculatePnlPercentage(
          signal.entryPrice,
          closePrice,
        );

        const holdTimeSeconds = Math.floor(
          (Date.now() - signal.createdAt.getTime()) / 1000,
        );

        await this.providerStatsService.onSignalClosed(
          signal.providerId,
          SignalOutcome.EXPIRED,
          pnlPercentage,
          holdTimeSeconds,
          signal.copiersCount,
          signal.totalCopiedVolume,
        );

        expiredCount++;
      } catch (error) {
        this.logger.error(`Error expiring signal ${signal.id}: ${error}`);
      }
    }

    this.logger.log(`Expired ${expiredCount} signals`);

    return { expired: expiredCount };
  }

  @OnQueueActive()
  onActive(job: Job) {
    this.logger.debug(
      `Processing job ${job.id} of type ${job.name}...`,
    );
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: unknown) {
    this.logger.debug(
      `Job ${job.id} completed with result: ${JSON.stringify(result)}`,
    );
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `Job ${job.id} failed with error: ${error.message}`,
    );
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
