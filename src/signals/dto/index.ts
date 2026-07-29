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
  IsBoolean,
} from 'class-validator';
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
  @IsPositive()
  entryPrice!: string;

  @IsString()
  @IsPositive()
  targetPrice!: string;

  @IsOptional()
  @IsString()
  stopLossPrice?: string;

  @IsOptional()
  @IsString()
  rationale?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  confidenceScore?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: Date;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  tier?: string;

  @IsOptional()
  @IsBoolean()
  isStaked?: boolean;

  @IsOptional()
  @IsEnum(SignalOutcome)
  outcome?: SignalOutcome;
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
}
