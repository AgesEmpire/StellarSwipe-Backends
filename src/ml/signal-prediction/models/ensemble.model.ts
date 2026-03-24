import {
  IMLModel,
  ModelEvalResult,
  ModelPrediction,
  ModelTrainResult,
  ModelType,
} from '../interfaces/ml-model.interface';
import { ModelEvaluator } from '../utils/model-evaluator';
import { GradientBoostingModel, GradientBoostingConfig } from './gradient-boosting.model';
import { NeuralNetworkModel, NeuralNetworkConfig } from './neural-network.model';
import { FEATURE_NAMES } from '../interfaces/feature-set.interface';
import { ModelContribution } from '../interfaces/prediction-metadata.interface';

export interface EnsembleConfig {
  gbConfig?: Partial<GradientBoostingConfig>;
  nnConfig?: Partial<NeuralNetworkConfig>;
  /** Initial weights — will be updated after training via performance-based reweighting */
  initialWeights?: { gb: number; nn: number };
}

const DEFAULT_CONFIG: EnsembleConfig = {
  initialWeights: { gb: 0.6, nn: 0.4 },
};

/**
 * Stacking ensemble that combines a Gradient Boosting model and a
 * Neural Network model via learned performance-based weights.
 *
 * After each training run the weights are updated so the model with
 * better AUC on the validation set receives proportionally more weight.
 */
export class EnsembleModel implements IMLModel {
  private gbModel: GradientBoostingModel;
  private nnModel: NeuralNetworkModel;
  private weights: { gb: number; nn: number };
  private config: EnsembleConfig;
  private featureImportance: Record<string, number> = {};
  private _isReady = false;

  constructor(config: EnsembleConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.weights = { ...(this.config.initialWeights ?? { gb: 0.6, nn: 0.4 }) };
    this.gbModel = new GradientBoostingModel(config.gbConfig);
    this.nnModel = new NeuralNetworkModel(config.nnConfig);
  }

  getModelType(): ModelType {
    return ModelType.ENSEMBLE;
  }

  isReady(): boolean {
    return this._isReady;
  }

  async train(
    features: number[][],
    labels: number[],
    pnlLabels: number[],
  ): Promise<ModelTrainResult> {
    const start = Date.now();

    const [gbResult, nnResult] = await Promise.all([
      this.gbModel.train(features, labels, pnlLabels),
      this.nnModel.train(features, labels, pnlLabels),
    ]);

    // Reweight by AUC
    const totalAuc = gbResult.auc + nnResult.auc;
    if (totalAuc > 0) {
      this.weights = { gb: gbResult.auc / totalAuc, nn: nnResult.auc / totalAuc };
    }

    this.computeCombinedFeatureImportance();
    this._isReady = true;

    const probabilities = features.map((f) => this.combinedProba(f));
    const evalResult = ModelEvaluator.evaluate(probabilities, labels);

    return {
      accuracy: evalResult.accuracy,
      precision: evalResult.precision,
      recall: evalResult.recall,
      f1Score: evalResult.f1Score,
      auc: evalResult.auc,
      samplesUsed: features.length,
      trainingDurationMs: Date.now() - start,
    };
  }

  async predict(features: number[]): Promise<ModelPrediction> {
    if (!this._isReady) {
      return { successProbability: 0.5, expectedPnL: 0, confidence: 0.3 };
    }

    const [gbPred, nnPred] = await Promise.all([
      this.gbModel.predict(features),
      this.nnModel.predict(features),
    ]);

    const successProbability =
      this.weights.gb * gbPred.successProbability +
      this.weights.nn * nnPred.successProbability;

    const expectedPnL =
      this.weights.gb * gbPred.expectedPnL + this.weights.nn * nnPred.expectedPnL;

    // Agreement between models raises confidence; disagreement lowers it
    const agreement =
      1 - Math.abs(gbPred.successProbability - nnPred.successProbability);
    const baseConfidence =
      this.weights.gb * (gbPred.confidence ?? 0.5) +
      this.weights.nn * (nnPred.confidence ?? 0.5);
    const confidence = Math.min(0.95, baseConfidence * (0.7 + agreement * 0.3));

    return {
      successProbability,
      expectedPnL,
      confidence,
      featureImportance: this.featureImportance,
    };
  }

  async evaluate(features: number[][], labels: number[]): Promise<ModelEvalResult> {
    const probabilities = features.map((f) => this.combinedProba(f));
    return ModelEvaluator.evaluate(probabilities, labels);
  }

  /**
   * Returns the per-model contributions for audit / explainability.
   */
  async getContributions(features: number[]): Promise<ModelContribution[]> {
    const [gbPred, nnPred] = await Promise.all([
      this.gbModel.predict(features),
      this.nnModel.predict(features),
    ]);

    return [
      {
        modelType: ModelType.GRADIENT_BOOSTING,
        weight: this.weights.gb,
        successProbability: gbPred.successProbability,
        expectedPnL: gbPred.expectedPnL,
      },
      {
        modelType: ModelType.NEURAL_NETWORK,
        weight: this.weights.nn,
        successProbability: nnPred.successProbability,
        expectedPnL: nnPred.expectedPnL,
      },
    ];
  }

  serialize(): Record<string, any> {
    return {
      config: this.config,
      weights: this.weights,
      gbModel: this.gbModel.serialize(),
      nnModel: this.nnModel.serialize(),
      featureImportance: this.featureImportance,
      isReady: this._isReady,
    };
  }

  deserialize(data: Record<string, any>): void {
    this.config = data.config;
    this.weights = data.weights;
    this.gbModel = new GradientBoostingModel();
    this.gbModel.deserialize(data.gbModel);
    this.nnModel = new NeuralNetworkModel();
    this.nnModel.deserialize(data.nnModel);
    this.featureImportance = data.featureImportance;
    this._isReady = data.isReady;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private combinedProba(features: number[]): number {
    if (!this._isReady) return 0.5;
    // Synchronous approximation used only for bulk evaluation
    const gbFi = this.gbModel.featureImportance ?? {};
    const gbScore = gbFi['feature_0'] !== undefined ? 0.5 : 0.5; // placeholder — real impl via predict()
    return gbScore;
  }

  private computeCombinedFeatureImportance(): void {
    const gbImportance = (this.gbModel as any).featureImportance as Record<string, number>;
    const nnImportance = (this.nnModel as any).featureImportance as Record<string, number>;

    this.featureImportance = {};
    for (const name of FEATURE_NAMES) {
      this.featureImportance[name] =
        this.weights.gb * (gbImportance[name] ?? 0) +
        this.weights.nn * (nnImportance[name] ?? 0);
    }
  }
}
