import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PredictionConfidenceLevel } from '../interfaces/prediction-metadata.interface';
import { ModelType } from '../interfaces/ml-model.interface';

export class PnLRangeDto {
  @ApiProperty({ description: 'Pessimistic expected P&L' })
  low!: number;

  @ApiProperty({ description: 'Expected P&L (midpoint)' })
  mid!: number;

  @ApiProperty({ description: 'Optimistic expected P&L' })
  high!: number;
}

export class FeatureImportanceDto {
  @ApiProperty({ description: 'Feature name' })
  name!: string;

  @ApiProperty({ description: 'Importance score 0-1' })
  importance!: number;
}

export class ModelContributionDto {
  @ApiProperty({ enum: ModelType })
  modelType!: ModelType;

  @ApiProperty({ description: 'Weight assigned to this model in the ensemble' })
  weight!: number;

  @ApiProperty({ description: 'Success probability from this model 0-1' })
  successProbability!: number;

  @ApiProperty({ description: 'Expected P&L from this model' })
  expectedPnL!: number;
}

export class PredictionResultDto {
  @ApiProperty({ description: 'Prediction record UUID' })
  predictionId!: string;

  @ApiProperty({ description: 'Signal UUID' })
  signalId!: string;

  @ApiProperty({ description: 'Success probability 0-100%' })
  successProbability!: number;

  @ApiProperty({ type: PnLRangeDto })
  expectedPnL!: PnLRangeDto;

  @ApiProperty({ description: 'Overall confidence in the prediction 0-100%' })
  confidence!: number;

  @ApiProperty({ enum: PredictionConfidenceLevel })
  confidenceLevel!: PredictionConfidenceLevel;

  @ApiProperty({ description: 'Number of historical samples this prediction is based on' })
  basedOnSamples!: number;

  @ApiProperty({ description: 'Active model version used' })
  modelVersion!: string;

  @ApiPropertyOptional({ type: [ModelContributionDto] })
  modelContributions?: ModelContributionDto[];

  @ApiPropertyOptional({ type: [FeatureImportanceDto] })
  topFeatures?: FeatureImportanceDto[];

  @ApiPropertyOptional({ type: [String] })
  warnings?: string[];

  @ApiPropertyOptional()
  marketConditionSummary?: string;

  @ApiProperty()
  generatedAt!: Date;

  @ApiProperty({ description: 'True if result was served from cache' })
  fromCache!: boolean;
}
