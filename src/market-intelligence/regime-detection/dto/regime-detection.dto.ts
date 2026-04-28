import { IsString, IsOptional, IsEnum, IsNumber, Min, Max } from 'class-validator';
import { MarketRegimeType } from '../entities/market-regime.entity';

export class DetectRegimeDto {
  @IsString()
  @IsOptional()
  assetPair?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(200)
  lookbackPeriods?: number;
}

export class RegimeResponseDto {
  id: string;
  assetPair: string | null;
  type: MarketRegimeType;
  confidence: number;
  startTime: Date;
  endTime: Date | null;
  metrics: Record<string, any> | null;
  summary: string;
}

export class RegimeTransitionDto {
  id: string;
  assetPair: string | null;
  fromRegime: MarketRegimeType;
  toRegime: MarketRegimeType;
  confidence: number;
  occurredAt: Date;
  reason: string | null;
}
