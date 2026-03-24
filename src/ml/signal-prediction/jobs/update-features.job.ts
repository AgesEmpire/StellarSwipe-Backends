import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Signal, SignalStatus } from '../../../signals/entities/signal.entity';
import { TrainingData } from '../entities/training-data.entity';
import { FeatureExtractorService } from '../feature-extractor.service';
import { SignalPredictorService } from '../signal-predictor.service';

/**
 * Periodically refreshes feature snapshots for active signals and
 * invalidates stale prediction caches so the next request gets a
 * fresh ML prediction with up-to-date market conditions.
 */
@Injectable()
export class UpdateFeaturesJob {
  private readonly logger = new Logger(UpdateFeaturesJob.name);
  private readonly BATCH_SIZE = 50;

  constructor(
    @InjectRepository(Signal)
    private signalRepository: Repository<Signal>,
    @InjectRepository(TrainingData)
    private trainingDataRepository: Repository<TrainingData>,
    private featureExtractor: FeatureExtractorService,
    private signalPredictor: SignalPredictorService,
  ) {}

  /**
   * Refresh features for active signals every 15 minutes.
   * Invalidates the prediction cache so stale forecasts are not served.
   */
  @Cron('*/15 * * * *', { name: 'update-active-signal-features', timeZone: 'UTC' })
  async refreshActiveSignalFeatures(): Promise<void> {
    const activeSignals = await this.signalRepository.find({
      where: { status: SignalStatus.ACTIVE },
      order: { updatedAt: 'ASC' },
      take: this.BATCH_SIZE,
    });

    if (activeSignals.length === 0) return;

    this.logger.debug(`Refreshing features for ${activeSignals.length} active signals`);
    let invalidated = 0;

    for (const signal of activeSignals) {
      try {
        // Extract new features to check if they changed meaningfully
        const newVector = await this.featureExtractor.extractAndVectorize(signal);

        // Check if market features (indices 7-11) have drifted significantly
        const existing = await this.trainingDataRepository.findOne({
          where: { signalId: signal.id },
        });

        const shouldInvalidate = !existing || this.hasDrifted(
          existing.featureVector as number[],
          newVector,
          [7, 8, 9, 10, 11], // Market feature indices
          0.1,               // 10% drift threshold
        );

        if (shouldInvalidate) {
          await this.signalPredictor.invalidateCache(signal.id);
          invalidated++;
        }
      } catch (err) {
        this.logger.warn(`Feature update failed for signal ${signal.id}: ${err}`);
      }
    }

    if (invalidated > 0) {
      this.logger.log(`Invalidated prediction cache for ${invalidated}/${activeSignals.length} signals due to feature drift`);
    }
  }

  /**
   * Back-fills feature vectors for recently closed signals that are
   * missing training data entries. Runs every 6 hours.
   */
  @Cron('0 */6 * * *', { name: 'backfill-training-features', timeZone: 'UTC' })
  async backfillMissingTrainingData(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const closedSignals = await this.signalRepository
      .createQueryBuilder('s')
      .where('s.status = :status', { status: SignalStatus.CLOSED })
      .andWhere('s.created_at >= :since', { since: sevenDaysAgo })
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM ml_training_data td WHERE td.signal_id = s.id
        )`,
      )
      .take(this.BATCH_SIZE)
      .getMany();

    if (closedSignals.length === 0) return;

    this.logger.log(`Back-filling training data for ${closedSignals.length} closed signals`);
    let filled = 0;

    for (const signal of closedSignals) {
      try {
        const featureVector = await this.featureExtractor.extractAndVectorize(signal);
        const featureSnapshot = await this.featureExtractor.extract(signal);
        const successLabel: 0 | 1 = signal.outcome === 'TARGET_HIT' ? 1 : 0;

        await this.trainingDataRepository.save({
          signalId: signal.id,
          providerId: signal.providerId,
          assetPair: `${signal.baseAsset}/${signal.counterAsset}`,
          featureVector,
          featureSnapshot: featureSnapshot as unknown as Record<string, any>,
          successLabel,
          pnlLabel: Number(signal.totalProfitLoss),
          outcome: signal.outcome,
          isValidated: true,
          collectedAt: signal.closedAt ?? signal.updatedAt,
        });

        filled++;
      } catch (err) {
        this.logger.warn(`Back-fill failed for signal ${signal.id}: ${err}`);
      }
    }

    this.logger.log(`Back-filled ${filled}/${closedSignals.length} training data records`);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private hasDrifted(
    oldVector: number[],
    newVector: number[],
    featureIndices: number[],
    threshold: number,
  ): boolean {
    return featureIndices.some((i) => {
      const old = oldVector[i] ?? 0;
      const next = newVector[i] ?? 0;
      return Math.abs(next - old) > threshold;
    });
  }
}
