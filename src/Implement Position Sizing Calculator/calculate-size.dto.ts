import {
  IsNumber,
  IsString,
  IsEnum,
  Min,
  Max,
  IsOptional,
} from 'class-validator';

export enum SizingMethod {
  FIXED = 'fixed',
  KELLY = 'kelly',
  VOLATILITY = 'volatility',
}

export class CalculateSizeDto {
  @IsNumber()
  @Min(1)
  accountBalance: number;

  @IsNumber()
  @Min(0.1)
  @Max(5)
  riskPercentage: number;

  @IsString()
  signalId: string;

  @IsEnum(SizingMethod)
  method: SizingMethod;

  // Kelly Criterion inputs
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  winRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  avgWin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  avgLoss?: number;

  // Volatility-adjusted inputs
  @IsOptional()
  @IsNumber()
  @Min(0)
  assetVolatility?: number; // e.g. annualized volatility as decimal (0.20 = 20%)

  // Signal confidence score (0-1)
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  signalConfidence?: number;

  // Optional: maximum position size as % of account
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxPositionPct?: number;
}
