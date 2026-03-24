import { ModelType } from './ml-model.interface';
import { FeatureName } from './feature-set.interface';

export enum PredictionConfidenceLevel {
  VERY_LOW = 'VERY_LOW',   // < 40%
  LOW = 'LOW',             // 40-55%
  MEDIUM = 'MEDIUM',       // 55-70%
  HIGH = 'HIGH',           // 70-85%
  VERY_HIGH = 'VERY_HIGH', // > 85%
}

export interface ModelContribution {
  modelType: ModelType;
  weight: number;
  successProbability: number;
  expectedPnL: number;
}

export interface IPredictionMetadata {
  modelVersion: string;
  modelsUsed: ModelContribution[];
  topFeatures: Array<{ name: FeatureName; importance: number }>;
  confidenceLevel: PredictionConfidenceLevel;
  trainingDataSize: number;
  predictionGeneratedAt: Date;
  warnings: string[];
  marketConditionSummary: string;
}

export function getConfidenceLevel(confidence: number): PredictionConfidenceLevel {
  if (confidence < 0.4) return PredictionConfidenceLevel.VERY_LOW;
  if (confidence < 0.55) return PredictionConfidenceLevel.LOW;
  if (confidence < 0.7) return PredictionConfidenceLevel.MEDIUM;
  if (confidence < 0.85) return PredictionConfidenceLevel.HIGH;
  return PredictionConfidenceLevel.VERY_HIGH;
}
