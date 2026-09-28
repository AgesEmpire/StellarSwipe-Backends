import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { TradeSide } from '../../entities/trade.entity';
import { OrderType } from '../../services/trade-execution-orchestrator.service';

export enum SwipeSource {
  GESTURE = 'gesture',
  KEYBOARD = 'keyboard',
  BUTTON = 'button',
}

export class SwipeIntentDto {
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

  @IsEnum(SwipeSource)
  @IsNotEmpty()
  source!: SwipeSource;

  /** Optional keyboard shortcut identifier, e.g. "shift+right" */
  @IsString()
  @IsOptional()
  shortcutKey?: string;

  /** Explicit confirmation flag required for button-sourced actions */
  @IsOptional()
  confirmAction?: boolean;

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

  /** Caller-requested order type; orchestrator resolves from signal if omitted */
  @IsEnum(OrderType)
  @IsOptional()
  orderTypeOverride?: OrderType;
}
