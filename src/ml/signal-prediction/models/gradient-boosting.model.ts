import {
  IMLModel,
  ModelEvalResult,
  ModelPrediction,
  ModelTrainResult,
  ModelType,
} from '../interfaces/ml-model.interface';
import { ModelEvaluator } from '../utils/model-evaluator';
import { FEATURE_NAMES } from '../interfaces/feature-set.interface';

interface DecisionNode {
  featureIndex: number;
  threshold: number;
  value?: number;
  left?: DecisionNode;
  right?: DecisionNode;
}

interface Tree {
  root: DecisionNode;
  learningRate: number;
}

export interface GradientBoostingConfig {
  nEstimators: number;
  maxDepth: number;
  learningRate: number;
  subsampleRatio: number;
  minSamplesLeaf: number;
}

const DEFAULT_CONFIG: GradientBoostingConfig = {
  nEstimators: 100,
  maxDepth: 3,
  learningRate: 0.1,
  subsampleRatio: 0.8,
  minSamplesLeaf: 5,
};

/**
 * Gradient-boosted decision trees for binary classification + regression.
 *
 * Uses residual (pseudo-gradient) fitting with a logistic loss for the
 * classification head and MSE for the regression (PnL) head.
 * Both heads share the same feature tree ensemble.
 */
export class GradientBoostingModel implements IMLModel {
  private trees: Tree[] = [];
  private pnlTrees: Tree[] = [];
  private baseScore = 0;
  private config: GradientBoostingConfig;
  private featureImportance: Record<string, number> = {};
  private _isReady = false;

  constructor(config: Partial<GradientBoostingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getModelType(): ModelType {
    return ModelType.GRADIENT_BOOSTING;
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
    const n = features.length;

    this.baseScore = labels.reduce((s, l) => s + l, 0) / n;
    this.trees = [];
    this.pnlTrees = [];

    // --- Classification head (logistic loss) ---
    let classResiduals = labels.map((l) => l - this.sigmoid(this.baseScore));

    for (let t = 0; t < this.config.nEstimators; t++) {
      const sample = this.subsample(features, classResiduals, n);
      const tree = this.buildTree(sample.features, sample.residuals, 0);
      this.trees.push({ root: tree, learningRate: this.config.learningRate });

      classResiduals = classResiduals.map((_, i) => {
        const pred = this.predictClassProba(features[i]);
        return labels[i] - pred;
      });
    }

    // --- Regression head (MSE loss) ---
    const basePnl = pnlLabels.reduce((s, l) => s + l, 0) / n;
    let pnlResiduals = pnlLabels.map((l) => l - basePnl);

    for (let t = 0; t < this.config.nEstimators; t++) {
      const sample = this.subsample(features, pnlResiduals, n);
      const tree = this.buildTree(sample.features, sample.residuals, 0);
      this.pnlTrees.push({ root: tree, learningRate: this.config.learningRate });

      pnlResiduals = pnlResiduals.map((_, i) => {
        const pred = this.predictPnl(features[i]);
        return pnlLabels[i] - pred;
      });
    }

    this.computeFeatureImportance(features, labels);
    this._isReady = true;

    const probabilities = features.map((f) => this.predictClassProba(f));
    const evalResult = ModelEvaluator.evaluate(probabilities, labels);

    return {
      accuracy: evalResult.accuracy,
      precision: evalResult.precision,
      recall: evalResult.recall,
      f1Score: evalResult.f1Score,
      auc: evalResult.auc,
      samplesUsed: n,
      trainingDurationMs: Date.now() - start,
    };
  }

  async predict(features: number[]): Promise<ModelPrediction> {
    const successProbability = this._isReady ? this.predictClassProba(features) : 0.5;
    const expectedPnL = this._isReady ? this.predictPnl(features) : 0;
    const confidence = this._isReady ? this.estimateConfidence(features) : 0.3;

    return { successProbability, expectedPnL, confidence, featureImportance: this.featureImportance };
  }

  async evaluate(features: number[][], labels: number[]): Promise<ModelEvalResult> {
    const probabilities = features.map((f) => this.predictClassProba(f));
    return ModelEvaluator.evaluate(probabilities, labels);
  }

  serialize(): Record<string, any> {
    return {
      config: this.config,
      baseScore: this.baseScore,
      trees: this.trees,
      pnlTrees: this.pnlTrees,
      featureImportance: this.featureImportance,
      isReady: this._isReady,
    };
  }

  deserialize(data: Record<string, any>): void {
    this.config = data.config;
    this.baseScore = data.baseScore;
    this.trees = data.trees;
    this.pnlTrees = data.pnlTrees;
    this.featureImportance = data.featureImportance;
    this._isReady = data.isReady;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private predictClassProba(features: number[]): number {
    let score = this.baseScore;
    for (const tree of this.trees) {
      score += tree.learningRate * this.traverseTree(tree.root, features);
    }
    return this.sigmoid(score);
  }

  private predictPnl(features: number[]): number {
    const basePnl = this.pnlTrees.length > 0 ? 0 : 0;
    let score = basePnl;
    for (const tree of this.pnlTrees) {
      score += tree.learningRate * this.traverseTree(tree.root, features);
    }
    return score;
  }

  private traverseTree(node: DecisionNode, features: number[]): number {
    if (node.value !== undefined) return node.value;
    if (features[node.featureIndex] <= node.threshold) {
      return this.traverseTree(node.left!, features);
    }
    return this.traverseTree(node.right!, features);
  }

  private buildTree(
    features: number[][],
    residuals: number[],
    depth: number,
  ): DecisionNode {
    if (depth >= this.config.maxDepth || features.length <= this.config.minSamplesLeaf) {
      return { featureIndex: 0, threshold: 0, value: this.mean(residuals) };
    }

    const best = this.bestSplit(features, residuals);
    if (!best) {
      return { featureIndex: 0, threshold: 0, value: this.mean(residuals) };
    }

    const leftIdx = features
      .map((f, i) => (f[best.featureIndex] <= best.threshold ? i : -1))
      .filter((i) => i >= 0);
    const rightIdx = features
      .map((f, i) => (f[best.featureIndex] > best.threshold ? i : -1))
      .filter((i) => i >= 0);

    if (leftIdx.length === 0 || rightIdx.length === 0) {
      return { featureIndex: 0, threshold: 0, value: this.mean(residuals) };
    }

    return {
      featureIndex: best.featureIndex,
      threshold: best.threshold,
      left: this.buildTree(
        leftIdx.map((i) => features[i]),
        leftIdx.map((i) => residuals[i]),
        depth + 1,
      ),
      right: this.buildTree(
        rightIdx.map((i) => features[i]),
        rightIdx.map((i) => residuals[i]),
        depth + 1,
      ),
    };
  }

  private bestSplit(
    features: number[][],
    residuals: number[],
  ): { featureIndex: number; threshold: number; gain: number } | null {
    const nFeatures = features[0]?.length ?? 0;
    let bestGain = -Infinity;
    let bestSplit: { featureIndex: number; threshold: number; gain: number } | null = null;

    const totalMSE = this.mse(residuals);

    for (let fi = 0; fi < nFeatures; fi++) {
      const values = [...new Set(features.map((f) => f[fi]))].sort((a, b) => a - b);
      for (let vi = 0; vi < values.length - 1; vi++) {
        const threshold = (values[vi] + values[vi + 1]) / 2;
        const leftRes = residuals.filter((_, i) => features[i][fi] <= threshold);
        const rightRes = residuals.filter((_, i) => features[i][fi] > threshold);

        if (leftRes.length < this.config.minSamplesLeaf || rightRes.length < this.config.minSamplesLeaf) continue;

        const gain =
          totalMSE -
          (leftRes.length * this.mse(leftRes) + rightRes.length * this.mse(rightRes)) /
            residuals.length;

        if (gain > bestGain) {
          bestGain = gain;
          bestSplit = { featureIndex: fi, threshold, gain };
        }
      }
    }

    return bestSplit;
  }

  private computeFeatureImportance(features: number[][], labels: number[]): void {
    const n = features[0]?.length ?? 0;
    const gains = new Array(n).fill(0);
    let totalGain = 0;

    const countGains = (node: DecisionNode): void => {
      if (node.value !== undefined) return;
      gains[node.featureIndex]++;
      totalGain++;
      if (node.left) countGains(node.left);
      if (node.right) countGains(node.right);
    };

    for (const tree of this.trees) countGains(tree.root);

    this.featureImportance = {};
    for (let i = 0; i < n; i++) {
      const name = FEATURE_NAMES[i] ?? `feature_${i}`;
      this.featureImportance[name] = totalGain > 0 ? gains[i] / totalGain : 0;
    }
  }

  private estimateConfidence(features: number[]): number {
    // Higher confidence when features are within the "normal" range [0.1, 0.9]
    const inRange = features.filter((f) => f >= 0.1 && f <= 0.9).length;
    return Math.min(0.95, 0.5 + (inRange / features.length) * 0.45);
  }

  private subsample(
    features: number[][],
    residuals: number[],
    n: number,
  ): { features: number[][]; residuals: number[] } {
    const size = Math.floor(n * this.config.subsampleRatio);
    const indices: number[] = [];
    const used = new Set<number>();
    while (indices.length < size) {
      const idx = Math.floor(Math.random() * n);
      if (!used.has(idx)) {
        used.add(idx);
        indices.push(idx);
      }
    }
    return {
      features: indices.map((i) => features[i]),
      residuals: indices.map((i) => residuals[i]),
    };
  }

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
  }

  private mean(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  private mse(arr: number[]): number {
    const m = this.mean(arr);
    return arr.reduce((s, v) => s + Math.pow(v - m, 2), 0) / (arr.length || 1);
  }
}
