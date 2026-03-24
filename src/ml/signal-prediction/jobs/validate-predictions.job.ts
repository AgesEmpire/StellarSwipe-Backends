import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, LessThan } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Prediction } from '../entities/prediction.entity';
import { Signal, SignalOutcome, SignalStatus } from '../../../signals/entities/signal.entity';
import { ModelEvaluator } from '../utils/model-evaluator';
import { ModelTrainerService } from '../model-trainer.service';

/**
 * Verifies past predictions against their actual signal outcomes
 * and populates the `actual_outcome`, `actual_pnl`, and `was_correct` fields.
 * Runs every hour.
 */
@Injectable()
export class ValidatePredictionsJob {
  private readonly logger = new Logger(ValidatePredictionsJob.name);
  private readonly BATCH_SIZE = 100;
  private readonly SUCCESS_THRESHOLD = 0.5; // Probability above which we predict "success"

  constructor(
    @InjectRepository(Prediction)
    private predictionRepository: Repository<Prediction>,
    @InjectRepository(Signal)
    private signalRepository: Repository<Signal>,
    private modelTrainer: ModelTrainerService,
  ) {}

  @Cron('0 * * * *', { name: 'validate-predictions', timeZone: 'UTC' })
  async run(): Promise<void> {
    const unverified = await this.predictionRepository.find({
      where: { isVerified: false },
      order: { createdAt: 'ASC' },
      take: this.BATCH_SIZE,
    });

    if (unverified.length === 0) return;

    this.logger.log(`Validating ${unverified.length} unverified predictions…`);
    let verified = 0;
    let correct = 0;

    for (const prediction of unverified) {
      const signal = await this.signalRepository.findOne({
        where: { id: prediction.signalId },
      });

      if (!signal) {
        // Signal no longer exists; mark as verified with unknown outcome
        await this.predictionRepository.update(prediction.id, {
          isVerified: true,
          verifiedAt: new Date(),
        });
        verified++;
        continue;
      }

      const isSettled =
        signal.status === SignalStatus.CLOSED ||
        signal.status === SignalStatus.EXPIRED ||
        signal.status === SignalStatus.CANCELLED;

      if (!isSettled) continue;

      const wasSuccess = signal.outcome === SignalOutcome.TARGET_HIT;
      const predictedSuccess = prediction.successProbability >= this.SUCCESS_THRESHOLD;
      const wasCorrect = predictedSuccess === wasSuccess;

      await this.predictionRepository.update(prediction.id, {
        actualOutcome: signal.outcome,
        actualPnl: Number(signal.totalProfitLoss),
        wasCorrect,
        isVerified: true,
        verifiedAt: new Date(),
      });

      // Feed closed signal into training data
      await this.modelTrainer.collectTrainingDataPoint(signal);

      verified++;
      if (wasCorrect) correct++;
    }

    if (verified > 0) {
      this.logger.log(
        `Validated ${verified} predictions — ${correct}/${verified} were correct ` +
          `(${((correct / verified) * 100).toFixed(1)}%)`,
      );
    }
  }

  /**
   * Daily accuracy report — runs at midnight UTC.
   */
  @Cron('0 0 * * *', { name: 'daily-prediction-accuracy-report', timeZone: 'UTC' })
  async dailyAccuracyReport(): Promise<void> {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    const verified = await this.predictionRepository.find({
      where: {
        isVerified: true,
        verifiedAt: Not(IsNull()),
        actualOutcome: Not(IsNull()),
      },
    });

    if (verified.length < 10) {
      this.logger.debug('Not enough verified predictions for accuracy report');
      return;
    }

    const probabilities = verified.map((p) => Number(p.successProbability));
    const labels = verified.map((p) =>
      p.actualOutcome === SignalOutcome.TARGET_HIT ? 1 : 0,
    );

    const evalResult = ModelEvaluator.evaluate(probabilities, labels);
    const calibration = ModelEvaluator.calibrationScore(probabilities, labels);

    this.logger.log(
      `Daily prediction accuracy report — ` +
        `samples: ${verified.length} ` +
        `accuracy: ${(evalResult.accuracy * 100).toFixed(1)}% ` +
        `AUC: ${evalResult.auc.toFixed(3)} ` +
        `F1: ${evalResult.f1Score.toFixed(3)} ` +
        `calibration: ${(calibration * 100).toFixed(1)}%`,
    );
  }
}
