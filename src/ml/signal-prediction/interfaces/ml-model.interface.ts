export enum ModelType {
  GRADIENT_BOOSTING = 'GRADIENT_BOOSTING',
  NEURAL_NETWORK = 'NEURAL_NETWORK',
  ENSEMBLE = 'ENSEMBLE',
}

export interface ModelPrediction {
  successProbability: number; // 0-1
  expectedPnL: number;
  confidence: number; // 0-1
  featureImportance?: Record<string, number>;
}

export interface ModelTrainResult {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  auc: number;
  samplesUsed: number;
  trainingDurationMs: number;
}

export interface ModelEvalResult {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  auc: number;
  confusionMatrix: [[number, number], [number, number]]; // [[TP, FP], [FN, TN]]
}

export interface IMLModel {
  getModelType(): ModelType;
  train(features: number[][], labels: number[], pnlLabels: number[]): Promise<ModelTrainResult>;
  predict(features: number[]): Promise<ModelPrediction>;
  evaluate(features: number[][], labels: number[]): Promise<ModelEvalResult>;
  serialize(): Record<string, any>;
  deserialize(data: Record<string, any>): void;
  isReady(): boolean;
}
