import { BaseEvent, EventMetadata } from './base.event';
import { IsNotEmpty, IsNumber, IsString, IsEnum, IsOptional, validateSync } from 'class-validator';

export enum TradeStatus {
  PENDING = 'PENDING',
  EXECUTED = 'EXECUTED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum TradeType {
  BUY = 'BUY',
  SELL = 'SELL',
}

/**
 * Emitted when a trade is successfully executed
 */
export class TradeExecutedEvent extends BaseEvent {
  readonly eventName = 'trade.executed';

  @IsNotEmpty()
  @IsString()
  readonly tradeId: string;

  @IsNotEmpty()
  @IsString()
  readonly userId: string;

  @IsNotEmpty()
  @IsString()
  readonly symbol: string;

  @IsNotEmpty()
  @IsEnum(TradeType)
  readonly type: TradeType;

  @IsNotEmpty()
  @IsNumber()
  readonly quantity: number;

  @IsNotEmpty()
  @IsNumber()
  readonly price: number;

  @IsNotEmpty()
  @IsNumber()
  readonly totalValue: number;

  @IsOptional()
  @IsString()
  readonly signalId?: string;

  @IsOptional()
  readonly metadata?: EventMetadata;

  constructor(data: {
    tradeId: string;
    userId: string;
    symbol: string;
    type: TradeType;
    quantity: number;
    price: number;
    totalValue: number;
    signalId?: string;
    metadata?: EventMetadata;
    correlationId?: string;
  }) {
    super(data.correlationId);
    Object.assign(this, data);
    this.validate();
  }

  validate(): void {
    const errors = validateSync(this);
    if (errors.length > 0) {
      throw new Error(`Trade event validation failed: ${JSON.stringify(errors)}`);
    }
    
    if (this.quantity <= 0) {
      throw new Error('Trade quantity must be positive');
    }
    
    if (this.price <= 0) {
      throw new Error('Trade price must be positive');
    }
  }
}

/**
 * Emitted when a trade fails
 */
export class TradeFailedEvent extends BaseEvent {
  readonly eventName = 'trade.failed';

  @IsNotEmpty()
  @IsString()
  readonly tradeId: string;

  @IsNotEmpty()
  @IsString()
  readonly userId: string;

  @IsNotEmpty()
  @IsString()
  readonly reason: string;

  @IsOptional()
  readonly metadata?: EventMetadata;

  constructor(data: {
    tradeId: string;
    userId: string;
    reason: string;
    metadata?: EventMetadata;
    correlationId?: string;
  }) {
    super(data.correlationId);
    Object.assign(this, data);
    this.validate();
  }

  validate(): void {
    const errors = validateSync(this);
    if (errors.length > 0) {
      throw new Error(`Trade failed event validation failed: ${JSON.stringify(errors)}`);
    }
  }
}

/**
 * Emitted when a trade is cancelled
 */
export class TradeCancelledEvent extends BaseEvent {
  readonly eventName = 'trade.cancelled';

  @IsNotEmpty()
  @IsString()
  readonly tradeId: string;

  @IsNotEmpty()
  @IsString()
  readonly userId: string;

  @IsNotEmpty()
  @IsString()
  readonly reason: string;

  constructor(data: {
    tradeId: string;
    userId: string;
    reason: string;
    correlationId?: string;
  }) {
    super(data.correlationId);
    Object.assign(this, data);
    this.validate();
  }

  validate(): void {
    const errors = validateSync(this);
    if (errors.length > 0) {
      throw new Error(`Trade cancelled event validation failed: ${JSON.stringify(errors)}`);
    }
  }
}