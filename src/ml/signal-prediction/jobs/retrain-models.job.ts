import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ModelTrainerService } from '../model-trainer.service';

/**
 * Scheduled job that triggers full model retraining on a weekly cadence,
 * and a lighter incremental check nightly to decide whether the model
 * needs refreshing based on recent data volume.
 */
@Injectable()
export class RetrainModelsJob {
  private readonly logger = new Logger(RetrainModelsJob.name);
  private isRunning = false;

  constructor(private readonly modelTrainer: ModelTrainerService) {}

  /**
   * Full retraining every Sunday at 02:00 UTC.
   */
  @Cron('0 2 * * 0', { name: 'full-model-retrain', timeZone: 'UTC' })
  async runWeeklyRetrain(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Retraining already in progress — skipping scheduled run');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting scheduled weekly model retraining…');

    try {
      const result = await this.modelTrainer.train({ forceRetrain: true, maxSamples: 5000 });
      if (result) {
        this.logger.log(
          `Weekly retraining complete — accuracy: ${(result.accuracy * 100).toFixed(1)}% ` +
            `AUC: ${result.auc.toFixed(3)} ` +
            `samples: ${result.samplesUsed} ` +
            `duration: ${(result.trainingDurationMs / 1000).toFixed(1)}s`,
        );
      } else {
        this.logger.warn('Weekly retraining skipped — insufficient data');
      }
    } catch (err) {
      this.logger.error(`Weekly model retraining failed: ${err}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Nightly incremental check at 03:00 UTC Mon-Sat.
   * Triggers retraining only if 200+ new samples have been collected
   * since the last training run.
   */
  @Cron('0 3 * * 1-6', { name: 'incremental-retrain-check', timeZone: 'UTC' })
  async runIncrementalCheck(): Promise<void> {
    if (this.isRunning) return;

    const count = await this.modelTrainer.getSamplesCount();
    this.logger.debug(`Incremental check: ${count} total validated samples`);

    // Lightweight heuristic: retrain if we have a multiple of 200 samples above 200
    if (count >= 200 && count % 200 < 50) {
      this.logger.log(`Incremental retrain triggered at ${count} samples`);
      this.isRunning = true;
      try {
        await this.modelTrainer.train({ maxSamples: 2000 });
      } catch (err) {
        this.logger.error(`Incremental retraining failed: ${err}`);
      } finally {
        this.isRunning = false;
      }
    }
  }
}
