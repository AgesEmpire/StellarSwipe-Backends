import {
  IMLModel,
  ModelEvalResult,
  ModelPrediction,
  ModelTrainResult,
  ModelType,
} from '../interfaces/ml-model.interface';
import { ModelEvaluator } from '../utils/model-evaluator';
import { FEATURE_NAMES } from '../interfaces/feature-set.interface';

export interface NeuralNetworkConfig {
  hiddenLayers: number[];
  learningRate: number;
  epochs: number;
  batchSize: number;
  dropoutRate: number;
}

const DEFAULT_CONFIG: NeuralNetworkConfig = {
  hiddenLayers: [32, 16],
  learningRate: 0.001,
  epochs: 50,
  batchSize: 32,
  dropoutRate: 0.2,
};

interface Layer {
  weights: number[][];  // [outputSize][inputSize]
  biases: number[];     // [outputSize]
}

/**
 * Feedforward neural network with sigmoid output for binary classification
 * and a linear output for PnL regression.
 *
 * Uses mini-batch gradient descent with ReLU activations in hidden layers.
 * Trained end-to-end via backpropagation.
 */
export class NeuralNetworkModel implements IMLModel {
  private classLayers: Layer[] = [];
  private pnlLayers: Layer[] = [];
  private config: NeuralNetworkConfig;
  private featureImportance: Record<string, number> = {};
  private _isReady = false;

  constructor(config: Partial<NeuralNetworkConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getModelType(): ModelType {
    return ModelType.NEURAL_NETWORK;
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
    const inputSize = features[0]?.length ?? FEATURE_NAMES.length;

    this.classLayers = this.initLayers(inputSize, this.config.hiddenLayers, 1);
    this.pnlLayers = this.initLayers(inputSize, this.config.hiddenLayers, 1);

    const n = features.length;

    for (let epoch = 0; epoch < this.config.epochs; epoch++) {
      const batches = this.createBatches(n, this.config.batchSize);
      for (const batch of batches) {
        const batchFeatures = batch.map((i) => features[i]);
        const batchLabels = batch.map((i) => labels[i]);
        const batchPnl = batch.map((i) => pnlLabels[i]);

        this.backprop(this.classLayers, batchFeatures, batchLabels, 'sigmoid');
        this.backprop(this.pnlLayers, batchFeatures, batchPnl, 'linear');
      }
    }

    this.computeFeatureImportance();
    this._isReady = true;

    const probabilities = features.map((f) => this.forwardPass(this.classLayers, f, 'sigmoid')[0]);
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
    if (!this._isReady) {
      return { successProbability: 0.5, expectedPnL: 0, confidence: 0.3 };
    }
    const successProbability = this.forwardPass(this.classLayers, features, 'sigmoid')[0];
    const expectedPnL = this.forwardPass(this.pnlLayers, features, 'linear')[0];
    const confidence = this.estimateConfidence(successProbability);
    return { successProbability, expectedPnL, confidence, featureImportance: this.featureImportance };
  }

  async evaluate(features: number[][], labels: number[]): Promise<ModelEvalResult> {
    const probabilities = features.map((f) =>
      this._isReady ? this.forwardPass(this.classLayers, f, 'sigmoid')[0] : 0.5,
    );
    return ModelEvaluator.evaluate(probabilities, labels);
  }

  serialize(): Record<string, any> {
    return {
      config: this.config,
      classLayers: this.classLayers,
      pnlLayers: this.pnlLayers,
      featureImportance: this.featureImportance,
      isReady: this._isReady,
    };
  }

  deserialize(data: Record<string, any>): void {
    this.config = data.config;
    this.classLayers = data.classLayers;
    this.pnlLayers = data.pnlLayers;
    this.featureImportance = data.featureImportance;
    this._isReady = data.isReady;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private initLayers(inputSize: number, hiddenSizes: number[], outputSize: number): Layer[] {
    const layers: Layer[] = [];
    const sizes = [inputSize, ...hiddenSizes, outputSize];
    for (let i = 0; i < sizes.length - 1; i++) {
      layers.push({
        weights: Array.from({ length: sizes[i + 1] }, () =>
          Array.from({ length: sizes[i] }, () => (Math.random() - 0.5) * Math.sqrt(2 / sizes[i])),
        ),
        biases: new Array(sizes[i + 1]).fill(0),
      });
    }
    return layers;
  }

  private forwardPass(layers: Layer[], input: number[], outputActivation: 'sigmoid' | 'linear'): number[] {
    let current = input.slice();
    for (let l = 0; l < layers.length; l++) {
      const layer = layers[l];
      const next: number[] = [];
      for (let j = 0; j < layer.biases.length; j++) {
        let sum = layer.biases[j];
        for (let k = 0; k < current.length; k++) {
          sum += layer.weights[j][k] * current[k];
        }
        const isOutput = l === layers.length - 1;
        next.push(isOutput
          ? (outputActivation === 'sigmoid' ? this.sigmoid(sum) : sum)
          : this.relu(sum));
      }
      current = next;
    }
    return current;
  }

  private backprop(
    layers: Layer[],
    batchFeatures: number[][],
    batchTargets: number[],
    outputActivation: 'sigmoid' | 'linear',
  ): void {
    const lr = this.config.learningRate / batchFeatures.length;

    // Collect activations for each sample
    for (let s = 0; s < batchFeatures.length; s++) {
      const activations: number[][] = [batchFeatures[s].slice()];
      let current = batchFeatures[s].slice();

      for (let l = 0; l < layers.length; l++) {
        const layer = layers[l];
        const next: number[] = [];
        for (let j = 0; j < layer.biases.length; j++) {
          let sum = layer.biases[j];
          for (let k = 0; k < current.length; k++) {
            sum += layer.weights[j][k] * current[k];
          }
          const isOutput = l === layers.length - 1;
          next.push(isOutput
            ? (outputActivation === 'sigmoid' ? this.sigmoid(sum) : sum)
            : this.relu(sum));
        }
        activations.push(next);
        current = next;
      }

      // Output error
      const output = activations[activations.length - 1];
      let delta = output.map((o, j) => {
        const err = o - batchTargets[s];
        return outputActivation === 'sigmoid' ? err * o * (1 - o) : err;
      });

      // Backprop through layers
      for (let l = layers.length - 1; l >= 0; l--) {
        const layer = layers[l];
        const input = activations[l];
        const newDelta: number[] = new Array(input.length).fill(0);

        for (let j = 0; j < layer.biases.length; j++) {
          layer.biases[j] -= lr * delta[j];
          for (let k = 0; k < input.length; k++) {
            layer.weights[j][k] -= lr * delta[j] * input[k];
            newDelta[k] += delta[j] * layer.weights[j][k];
          }
        }

        // Apply ReLU derivative for hidden layers
        if (l > 0) {
          delta = newDelta.map((d, k) => (activations[l][k] > 0 ? d : 0));
        }
      }
    }
  }

  private computeFeatureImportance(): void {
    if (this.classLayers.length === 0) return;
    const firstLayer = this.classLayers[0];
    // Use L1 norm of first-layer weights per input feature
    const inputSize = firstLayer.weights[0]?.length ?? 0;
    const importance = new Array(inputSize).fill(0);
    for (const neuronWeights of firstLayer.weights) {
      for (let k = 0; k < neuronWeights.length; k++) {
        importance[k] += Math.abs(neuronWeights[k]);
      }
    }
    const total = importance.reduce((s, v) => s + v, 0) || 1;
    this.featureImportance = {};
    for (let i = 0; i < inputSize; i++) {
      const name = FEATURE_NAMES[i] ?? `feature_${i}`;
      this.featureImportance[name] = importance[i] / total;
    }
  }

  private estimateConfidence(probability: number): number {
    // More confident when prediction is far from 0.5
    return Math.min(0.95, 0.5 + Math.abs(probability - 0.5) * 0.9);
  }

  private createBatches(n: number, batchSize: number): number[][] {
    const indices = Array.from({ length: n }, (_, i) => i);
    const batches: number[][] = [];
    for (let i = 0; i < n; i += batchSize) {
      batches.push(indices.slice(i, i + batchSize));
    }
    return batches;
  }

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
  }

  private relu(x: number): number {
    return Math.max(0, x);
  }
}
