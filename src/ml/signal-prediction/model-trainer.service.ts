import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Signal, SignalOutcome } from '../../signals/entities/signal.entity';
import { ModelVersion } from './entities/model-version.entity';
import { TrainingData } from './entities/training-data.entity';
import { EnsembleModel } from './models/ensemble.model';
import { GradientBoostingModel } from './models/gradient-boosting.model';
import { NeuralNetworkModel } from './models/neural-network.model';
import { FeatureExtractorService } from './feature-extractor.service';
import { DataPreprocessor } from './utils/data-preprocessor';
import { ModelEvaluator } from './utils/model-evaluator';
import { ModelType, ModelTrainResult } from './interfaces/ml-model.interface';
import { TrainingConfigDto } from './dto/training-config.dto';

const DEFAULT_CONFIG: Required<TrainingConfigDto> = {
  maxSamples: 5000,
  validationSplit: 0.2,
  minSamplesRequired: 50,
  gradientBoosting: {},
  neuralNetwork: {},
  forceRetrain: false,
};

@Injectable()
export class ModelTrainerService implements OnModuleInit {
  private readonly logger = new Logger(ModelTrainerService.name);

  private activeEnsemble: EnsembleModel | null = null;
  private activeVersionId: string | null = null;

  constructor(
    @InjectRepository(Signal)
    private signalRepository: Repository<Signal>,
    @InjectRepository(TrainingData)
    private trainingDataRepository: Repository<TrainingData>,
    @InjectRepository(ModelVersion)
    private modelVersionRepository: Repository<ModelVersion>,
    private featureExtractor: FeatureExtractorService,
  ) {}

  async onModuleInit() {
    await this.loadActiveModel();
    if (!this.activeEnsemble?.isReady()) {
      await this.trainIfSufficientData();
    }
  }

  @Cron(CronExpression.EVERY_WEEK)
  async scheduledRetraining() {
    this.logger.log('Scheduled weekly retraining started');
    await this.train({ forceRetrain: true });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async train(config: Partial<TrainingConfigDto> = {}): Promise<ModelTrainResult | null> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    const count = await this.trainingDataRepository.count({ where: { isValidated: true } });
    if (count < cfg.minSamplesRequired) {
      this.logger.warn(`Insufficient training data: ${count}/${cfg.minSamplesRequired} samples`);
      return null;
    }

    const rows = await this.trainingDataRepository.find({
      where: { isValidated: true },
      order: { collectedAt: 'DESC' },
      take: cfg.maxSamples,
    });

    const cleaned = DataPreprocessor.removeOutliers(rows);
    const dataset = DataPreprocessor.process(cleaned, cfg.validationSplit);
    const { trainFeatures, trainLabels, trainPnlLabels, valFeatures, valLabels } =
      DataPreprocessor.split(dataset);

    const { balancedFeatures, balancedLabels, balancedPnl } = this.balance(
      trainFeatures,
      trainLabels,
      trainPnlLabels,
    );

    const ensemble = new EnsembleModel({
      gbConfig: cfg.gradientBoosting,
      nnConfig: cfg.neuralNetwork,
    });

    this.logger.log(`Training ensemble on ${balancedFeatures.length} samples…`);
    const trainResult = await ensemble.train(balancedFeatures, balancedLabels, balancedPnl);

    // Evaluate on validation set
    const valResult = await ensemble.evaluate(valFeatures, valLabels);

    const version = await this.saveModelVersion(ensemble, trainResult, valResult, rows.length, cfg);
    await this.deactivatePreviousVersions(version.id);

    this.activeEnsemble = ensemble;
    this.activeVersionId = version.id;

    this.logger.log(
      `Training complete — accuracy: ${(valResult.accuracy * 100).toFixed(1)}% ` +
        `AUC: ${valResult.auc.toFixed(3)} version: ${version.version}`,
    );

    return trainResult;
  }

  async collectTrainingDataPoint(signal: Signal): Promise<void> {
    if (
      signal.outcome === SignalOutcome.PENDING ||
      signal.outcome === SignalOutcome.CANCELLED
    ) {
      return;
    }

    const existing = await this.trainingDataRepository.findOne({
      where: { signalId: signal.id },
    });
    if (existing) return;

    try {
      const featureVector = await this.featureExtractor.extractAndVectorize(signal);
      const featureSnapshot = await this.featureExtractor.extract(signal);
      const successLabel: 0 | 1 = signal.outcome === SignalOutcome.TARGET_HIT ? 1 : 0;
      const pnlLabel = Number(signal.totalProfitLoss);

      await this.trainingDataRepository.save({
        signalId: signal.id,
        providerId: signal.providerId,
        assetPair: `${signal.baseAsset}/${signal.counterAsset}`,
        featureVector,
        featureSnapshot: featureSnapshot as unknown as Record<string, any>,
        successLabel,
        pnlLabel,
        outcome: signal.outcome,
        isValidated: true,
        collectedAt: signal.closedAt ?? new Date(),
      });
    } catch (err) {
      this.logger.error(`Failed to collect training data for signal ${signal.id}: ${err}`);
    }
  }

  getActiveEnsemble(): EnsembleModel | null {
    return this.activeEnsemble;
  }

  getActiveVersionId(): string | null {
    return this.activeVersionId;
  }

  async getSamplesCount(): Promise<number> {
    return this.trainingDataRepository.count({ where: { isValidated: true } });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async trainIfSufficientData(): Promise<void> {
    const count = await this.trainingDataRepository.count({ where: { isValidated: true } });
    if (count >= DEFAULT_CONFIG.minSamplesRequired) {
      await this.train();
    } else {
      this.logger.log(
        `Skipping initial training — only ${count}/${DEFAULT_CONFIG.minSamplesRequired} validated samples available`,
      );
    }
  }

  private async loadActiveModel(): Promise<void> {
    const activeVersion = await this.modelVersionRepository.findOne({
      where: { modelType: ModelType.ENSEMBLE, isActive: true },
      order: { trainedAt: 'DESC' },
    });

    if (!activeVersion) return;

    try {
      const ensemble = new EnsembleModel();
      ensemble.deserialize(activeVersion.modelData);
      this.activeEnsemble = ensemble;
      this.activeVersionId = activeVersion.id;
      this.logger.log(`Loaded active ensemble model version ${activeVersion.version}`);
    } catch (err) {
      this.logger.error(`Failed to deserialize active model: ${err}`);
    }
  }

  private async saveModelVersion(
    ensemble: EnsembleModel,
    trainResult: ModelTrainResult,
    valResult: ReturnType<typeof ModelEvaluator.evaluate> extends Promise<infer T> ? T : any,
    samplesUsed: number,
    config: Required<TrainingConfigDto>,
  ): Promise<ModelVersion> {
    const versionTag = `v${Date.now()}`;
    const featureImportance = (ensemble as any).featureImportance ?? null;

    return this.modelVersionRepository.save({
      modelType: ModelType.ENSEMBLE,
      version: versionTag,
      isActive: true,
      accuracy: valResult.accuracy,
      precision: valResult.precision,
      recall: valResult.recall,
      f1Score: valResult.f1Score,
      auc: valResult.auc,
      samplesUsed,
      trainingDurationMs: trainResult.trainingDurationMs,
      modelData: ensemble.serialize(),
      featureImportance,
      trainingConfig: config as unknown as Record<string, any>,
      trainedAt: new Date(),
    });
  }

  private async deactivatePreviousVersions(currentId: string): Promise<void> {
    await this.modelVersionRepository
      .createQueryBuilder()
      .update()
      .set({ isActive: false })
      .where('id != :id AND model_type = :type AND is_active = true', {
        id: currentId,
        type: ModelType.ENSEMBLE,
      })
      .execute();
  }

  private balance(
    features: number[][],
    labels: number[],
    pnlLabels: number[],
  ): { balancedFeatures: number[][]; balancedLabels: number[]; balancedPnl: number[] } {
    const result = DataPreprocessor.balanceClasses(features, labels, pnlLabels);
    return {
      balancedFeatures: result.features,
      balancedLabels: result.labels,
      balancedPnl: result.pnlLabels,
    };
  }
}
