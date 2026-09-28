import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { RiskThresholdType } from '../entities/risk-threshold.entity';

export class RiskThresholdDto {
  @IsEnum(RiskThresholdType)
  type!: RiskThresholdType;

  @IsNumber()
  @Min(0)
  value!: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  updatedBy?: string;
}

export class RiskEvaluationDto {
  @IsNumber()
  @Min(0)
  orderSize!: number;

  @IsNumber()
  @Min(0)
  leverage!: number;

  assetExposure!: Record<string, number>;
}
