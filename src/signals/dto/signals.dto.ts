import {
  IsEnum,
  IsNumber,
  IsString,
  IsNotEmpty,
  IsPositive,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { SignalAction } from '../entities/signal.entity';

export class CreateSignalDto {
  @IsString()
  @IsNotEmpty()
  provider_id!: string;

  @IsString()
  @IsNotEmpty()
  asset_pair!: string;

  @IsEnum(SignalAction)
  action!: SignalAction;

  @IsNumber()
  @IsPositive()
  entry_price!: number;

  @IsNumber()
  @IsPositive()
  target_price!: number;

  @IsNumber()
  @IsPositive()
  stop_loss!: number;

  @IsString()
  @IsNotEmpty()
  rationale!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  confidence_score!: number;

  @IsDateString()
  expires_at!: string;
}

export class UpdateSignalPerformanceDto {
  @IsNumber()
  price_at_timestamp!: number;

  @IsNumber()
  unrealized_pnl!: number;

  @IsNumber()
  current_roi!: number;
}
