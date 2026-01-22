 feat/signal-autoclose
export * from './expiration.dto';

import {
  IsString,
  IsEnum,
  IsOptional,
  IsUUID,
  IsNumber,
  IsDateString,
  IsPositive,
  Min,
  Max,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SignalType, SignalStatus, SignalOutcome } from '../entities/signal.entity';

export class CreateSignalDto {
  @IsUUID()
  providerId!: string;

  @IsString()
  baseAsset!: string;

  @IsString()
  counterAsset!: string;

  @IsEnum(SignalType)
  type!: SignalType;

  @IsString()
  entryPrice!: string;

  @IsString()
  targetPrice!: string;

  @IsString()
  stopLossPrice!: string;

  @IsDateString()
  expiresAt!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateSignalDto {
  @IsOptional()
  @IsEnum(SignalStatus)
  status?: SignalStatus;

  @IsOptional()
  @IsEnum(SignalOutcome)
  outcome?: SignalOutcome;

  @IsOptional()
  @IsString()
  currentPrice?: string;

  @IsOptional()
  @IsString()
  closePrice?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  copiersCount?: number;

  @IsOptional()
  @IsString()
  totalCopiedVolume?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CopySignalDto {
  @IsUUID()
  signalId!: string;

  @IsUUID()
  copierId!: string;

  @IsString()
  @IsPositive()
  volume!: string;
}

export class SignalQueryDto {
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsOptional()
  @IsEnum(SignalStatus)
  status?: SignalStatus;

  @IsOptional()
  @IsEnum(SignalType)
  type?: SignalType;

  @IsOptional()
  @IsString()
  baseAsset?: string;

  @IsOptional()
  @IsString()
  counterAsset?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class PerformanceQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ProviderStatsQueryDto {
  @IsOptional()
  @IsString()
  sortBy?: 'winRate' | 'totalPnl' | 'reputationScore' | 'totalSignals';

  @IsOptional()
  @IsString()
  order?: 'ASC' | 'DESC';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class SignalPerformanceDto {
  signalId!: string;
  currentPrice!: string;
  entryPrice!: string;
  pnlPercentage!: string;
  pnlAbsolute!: string;
  distanceToTarget!: string;
  distanceToStopLoss!: string;
  maxDrawdown!: string;
  maxProfit!: string;
  timeElapsedSeconds!: number;
  status!: SignalStatus;
  outcome!: SignalOutcome;
}

export class ProviderStatsResponseDto {
  providerId!: string;
  totalSignals!: number;
  activeSignals!: number;
  winRate!: string;
  averagePnl!: string;
  totalPnl!: string;
  reputationScore!: string;
  totalCopiers!: number;
  totalVolumeCopied!: string;
  streakWins!: number;
  streakLosses!: number;
}

export class SignalStatsDto {
  totalActiveSignals!: number;
  totalClosedSignals!: number;
  averagePnl!: string;
  totalVolume!: string;
  topPerformingAssets!: { asset: string; avgPnl: string }[];
}
 main
