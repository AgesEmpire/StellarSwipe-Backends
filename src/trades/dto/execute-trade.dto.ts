import {
  IsUUID,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsPositive,
  Min,
  Max,
} from 'class-validator';
import { IsStellarPrecision } from '../../common/decorators/is-stellar-precision.decorator';
import { TradeSide } from '../entities/trade.entity';

export class ExecuteTradeDto {
  @IsUUID()
  @IsNotEmpty()
  userId!: string;

  @IsUUID()
  @IsNotEmpty()
  signalId!: string;

  @IsEnum(TradeSide)
  @IsNotEmpty()
  side!: TradeSide;

  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  @IsStellarPrecision()
  amount!: number;

  @IsNumber({ maxDecimalPlaces: 8 })
  @IsOptional()
  @IsPositive()
  @IsStellarPrecision()
  stopLossPrice?: number;

  @IsNumber({ maxDecimalPlaces: 8 })
  @IsOptional()
  @IsPositive()
  @IsStellarPrecision()
  takeProfitPrice?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  @Min(0)
  @Max(100)
  slippageTolerance?: number;

  @IsString()
  @IsOptional()
  walletAddress?: string;
}

export class CloseTradeDto {
  @IsUUID()
  @IsNotEmpty()
  tradeId!: string;

  @IsUUID()
  @IsNotEmpty()
  userId!: string;

  @IsNumber({ maxDecimalPlaces: 8 })
  @IsOptional()
  @IsPositive()
  @IsStellarPrecision()
  exitPrice?: number;
}

export class GetUserTradesDto {
  @IsUUID()
  @IsNotEmpty()
  userId!: string;

  @IsEnum(['pending', 'executing', 'completed', 'failed', 'cancelled', 'all'])
  @IsOptional()
  status?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  offset?: number;
}
