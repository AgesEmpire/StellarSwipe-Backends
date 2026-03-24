import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Signal } from '../../signals/entities/signal.entity';
import { Prediction } from './entities/prediction.entity';
import { ModelVersion } from './entities/model-version.entity';
import { FeatureExtractorService } from './feature-extractor.service';
import { ModelTrainerService } from './model-trainer.service';
import { PredictionRequestDto } from './dto/prediction-request.dto';
import { PredictionResultDto } from './dto/prediction-result.dto';
import {
  IPredictionMetadata,
  PredictionConfidenceLevel,
  getConfidenceLevel,
} from './interfaces/prediction-metadata.interface';
import { FEATURE_NAMES } from './interfaces/feature-set.interface';
import { ModelType } from './interfaces/ml-model.interface';

@Injectable()
export class SignalPredictorService {
  private readonly logger = new Logger(SignalPredictorService.name);
  private readonly CACHE_TTL_SECONDS = 1800; // 30 minutes

  constructor(
    @InjectRepository(Signal)
    private signalRepository: Repository<Signal>,
    @InjectRepository(Prediction)
    private predictionRepository: Repository<Prediction>,
    @InjectRepository(ModelVersion)
    private modelVersionRepository: Repository<ModelVersion>,
    private featureExtractor: FeatureExtractorService,
    private modelTrainer: ModelTrainerService,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  async predict(request: PredictionRequestDto): Promise<PredictionResultDto> {
    const cacheKey = `signal-prediction:${request.signalId}`;

    if (!request.forceRefresh) {
      const cached = await this.cacheManager.get<PredictionResultDto>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for signal ${request.signalId}`);
        return { ...cached, fromCache: true };
      }
    }

    const signal = await this.signalRepository.findOne({ where: { id: request.signalId } });
    if (!signal) throw new NotFoundException(`Signal ${request.signalId} not found`);

    const ensemble = this.modelTrainer.getActiveEnsemble();
    const versionId = this.modelTrainer.getActiveVersionId();
    const samplesCount = await this.modelTrainer.getSamplesCount();

    const featureVector = await this.featureExtractor.extractAndVectorize(signal);

    let successProbability: number;
    let expectedPnL: number;
    let confidence: number;
    let featureImportance: Record<string, number> | undefined;
    let modelContributions: any[] = [];

    if (ensemble?.isReady()) {
      const prediction = await ensemble.predict(featureVector);
      const contributions = await ensemble.getContributions(featureVector);

      successProbability = prediction.successProbability;
      expectedPnL = prediction.expectedPnL;
      confidence = prediction.confidence ?? this.estimateConfidence(samplesCount);
      featureImportance = prediction.featureImportance;
      modelContributions = contributions;
    } else {
      this.logger.warn(`No trained model available for signal ${signal.id} — using heuristic`);
      ({ successProbability, expectedPnL, confidence } = this.heuristicPrediction(featureVector));
      modelContributions = [];
    }

    const warnings = this.generateWarnings(featureVector, samplesCount, ensemble?.isReady() ?? false);
    const marketSummary = this.describeMarketCondition(featureVector);
    const confidenceLevel = getConfidenceLevel(confidence);
    const topFeatures = request.includeFeatureImportance !== false
      ? this.topNFeatures(featureImportance, 5)
      : undefined;

    const prediction = await this.predictionRepository.save({
      signalId: signal.id,
      providerId: signal.providerId,
      modelVersionId: versionId,
      successProbability,
      expectedPnlLow: expectedPnL * 0.6,
      expectedPnlMid: expectedPnL,
      expectedPnlHigh: expectedPnL * 1.5,
      confidenceScore: confidence,
      confidenceLevel,
      featureVector,
      modelContributions,
      topFeatures: topFeatures ?? null,
      warnings: warnings.length > 0 ? warnings : null,
      marketConditionSummary: marketSummary,
      actualOutcome: null,
      actualPnl: null,
      wasCorrect: null,
      isVerified: false,
      verifiedAt: null,
    });

    const activeVersion = versionId
      ? await this.modelVersionRepository.findOne({ where: { id: versionId } })
      : null;

    const result: PredictionResultDto = {
      predictionId: prediction.id,
      signalId: signal.id,
      successProbability: Math.round(successProbability * 100),
      expectedPnL: {
        low: parseFloat((expectedPnL * 0.6).toFixed(4)),
        mid: parseFloat(expectedPnL.toFixed(4)),
        high: parseFloat((expectedPnL * 1.5).toFixed(4)),
      },
      confidence: Math.round(confidence * 100),
      confidenceLevel,
      basedOnSamples: samplesCount,
      modelVersion: activeVersion?.version ?? 'heuristic',
      modelContributions: modelContributions.map((c) => ({
        modelType: c.modelType,
        weight: parseFloat(c.weight.toFixed(3)),
        successProbability: parseFloat(c.successProbability.toFixed(4)),
        expectedPnL: parseFloat(c.expectedPnL.toFixed(4)),
      })),
      topFeatures,
      warnings: warnings.length > 0 ? warnings : undefined,
      marketConditionSummary: marketSummary,
      generatedAt: prediction.createdAt,
      fromCache: false,
    };

    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL_SECONDS);
    return result;
  }

  async getPredictionHistory(signalId: string): Promise<Prediction[]> {
    return this.predictionRepository.find({
      where: { signalId },
      order: { createdAt: 'DESC' },
    });
  }

  async invalidateCache(signalId: string): Promise<void> {
    await this.cacheManager.del(`signal-prediction:${signalId}`);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private heuristicPrediction(features: number[]): {
    successProbability: number;
    expectedPnL: number;
    confidence: number;
  } {
    // Provider win rate (index 0), confidence (index 12), risk/reward (index 13)
    const providerWinRate = features[0] ?? 0.5;
    const signalConfidence = features[12] ?? 0.5;
    const riskReward = features[13] ?? 0.5;
    const marketTrend = features[8] ?? 0;

    const successProbability = Math.max(
      0.05,
      Math.min(0.95, providerWinRate * 0.5 + signalConfidence * 0.3 + (marketTrend + 1) / 2 * 0.2),
    );
    const expectedPnL = (riskReward * 0.1) * (successProbability > 0.5 ? 1 : -1);
    const confidence = 0.35; // Low confidence for heuristic

    return { successProbability, expectedPnL, confidence };
  }

  private estimateConfidence(samplesCount: number): number {
    return Math.min(0.9, 0.3 + (samplesCount / 2000) * 0.6);
  }

  private generateWarnings(
    features: number[],
    samplesCount: number,
    modelTrained: boolean,
  ): string[] {
    const warnings: string[] = [];

    if (!modelTrained) warnings.push('Model not yet trained — prediction is heuristic only');
    if (samplesCount < 100) warnings.push(`Low training data: only ${samplesCount} historical samples`);
    if (features[7] > 0.7) warnings.push('High asset volatility — prediction uncertainty is elevated');
    if (features[0] < 0.4) warnings.push('Provider has a below-average win rate');
    if (features[5] < 0.4) warnings.push('Provider recent performance is below historical average');
    if (features[6] < -0.5) warnings.push('Provider is on a losing streak');

    return warnings;
  }

  private describeMarketCondition(features: number[]): string {
    const trend = features[8] ?? 0;
    const volatility = features[7] ?? 0.3;

    const trendLabel = trend > 0.3 ? 'bullish' : trend < -0.3 ? 'bearish' : 'neutral';
    const volLabel = volatility > 0.6 ? 'high' : volatility > 0.3 ? 'moderate' : 'low';

    return `${trendLabel.charAt(0).toUpperCase() + trendLabel.slice(1)} market with ${volLabel} volatility`;
  }

  private topNFeatures(
    importance: Record<string, number> | undefined,
    n: number,
  ): Array<{ name: string; importance: number }> | undefined {
    if (!importance) return undefined;
    return Object.entries(importance)
      .sort(([, a], [, b]) => b - a)
      .slice(0, n)
      .map(([name, imp]) => ({ name, importance: parseFloat(imp.toFixed(4)) }));
  }
}
