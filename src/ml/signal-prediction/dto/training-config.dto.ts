import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class GradientBoostingConfigDto {
  @ApiPropertyOptional({ default: 100 })
  @IsOptional() @IsInt()
  nEstimators?: number;

  @ApiPropertyOptional({ default: 3 })
  @IsOptional() @IsInt()
  maxDepth?: number;

  @ApiPropertyOptional({ default: 0.1 })
  @IsOptional() @IsNumber()
  learningRate?: number;

  @ApiPropertyOptional({ default: 0.8 })
  @IsOptional() @IsNumber()
  subsampleRatio?: number;
}

export class NeuralNetworkConfigDto {
  @ApiPropertyOptional({ default: [32, 16] })
  @IsOptional()
  hiddenLayers?: number[];

  @ApiPropertyOptional({ default: 0.001 })
  @IsOptional() @IsNumber()
  learningRate?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional() @IsInt()
  epochs?: number;

  @ApiPropertyOptional({ default: 32 })
  @IsOptional() @IsInt()
  batchSize?: number;

  @ApiPropertyOptional({ default: 0.2 })
  @IsOptional() @IsNumber()
  dropoutRate?: number;
}

export class TrainingConfigDto {
  @ApiPropertyOptional({
    description: 'Maximum training samples (most recent first)',
    default: 5000,
  })
  @IsOptional() @IsInt() @Min(100) @Max(50000)
  maxSamples?: number;

  @ApiPropertyOptional({ description: 'Ratio of data used for validation', default: 0.2 })
  @IsOptional() @IsNumber() @Min(0.1) @Max(0.4)
  validationSplit?: number;

  @ApiPropertyOptional({ description: 'Minimum samples required to start training', default: 50 })
  @IsOptional() @IsInt() @Min(10)
  minSamplesRequired?: number;

  @ApiPropertyOptional({ type: GradientBoostingConfigDto })
  @IsOptional()
  gradientBoosting?: GradientBoostingConfigDto;

  @ApiPropertyOptional({ type: NeuralNetworkConfigDto })
  @IsOptional()
  neuralNetwork?: NeuralNetworkConfigDto;

  @ApiPropertyOptional({
    description: 'Force full retraining even if a model is already active',
    default: false,
  })
  @IsOptional() @IsBoolean()
  forceRetrain?: boolean;
}
