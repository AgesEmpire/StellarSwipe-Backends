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
  amount!: number;

  @IsNumber({ maxDecimalPlaces: 8 })
  @IsOptional()
  @IsPositive()
  stopLossPrice?: number;

  @IsNumber({ maxDecimalPlaces: 8 })
  @IsOptional()
  @IsPositive()
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
