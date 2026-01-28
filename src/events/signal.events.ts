import { BaseEvent, EventMetadata } from './base.event';
import { IsNotEmpty, IsNumber, IsString, IsEnum, IsOptional, validateSync, Min, Max } from 'class-validator';

export enum SignalType {
  BUY = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD',
}

export enum SignalStatus {
  PENDING = 'PENDING',
  VALIDATED = 'VALIDATED',
  REJECTED = 'REJECTED',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
}

/**
 * Emitted when a new trading signal is created
 */
export class SignalCreatedEvent extends BaseEvent {
  readonly eventName = 'signal.created';

  @IsNotEmpty()
  @IsString()
  readonly signalId: string;

  @IsNotEmpty()
  @IsString()
  readonly userId: string;

  @IsNotEmpty()
  @IsString()
  readonly symbol: string;

  @IsNotEmpty()
  @IsEnum(SignalType)
  readonly type: SignalType;

  @IsNotEmpty()
  @IsNumber()
  readonly targetPrice: number;

  @IsOptional()
  @IsNumber()
  readonly stopLoss?: number;

  @IsOptional()
  @IsNumber()
  readonly takeProfit?: number;

  @IsOptional()
  @IsString()
  readonly reasoning?: string;

  @IsOptional()
  readonly metadata?: EventMetadata;

  constructor(data: {
    signalId: string;
    userId: string;
    symbol: string;
    type: SignalType;
    targetPrice: number;
    stopLoss?: number;
    takeProfit?: number;
    reasoning?: string;
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
      throw new Error(`Signal created event validation failed: ${JSON.stringify(errors)}`);
    }

    if (this.targetPrice <= 0) {
      throw new Error('Target price must be positive');
    }
  }
}

/**
 * Emitted when signal performance metrics are updated
 */
export class SignalPerformanceUpdatedEvent extends BaseEvent {
  readonly eventName = 'signal.performance.updated';

  @IsNotEmpty()
  @IsString()
  readonly signalId: string;

  @IsNotEmpty()
  @IsString()
  readonly userId: string;

  @IsNotEmpty()
  @IsNumber()
  readonly performanceScore: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(-100)
  @Max(100)
  readonly returnPercentage: number;

  @IsNotEmpty()
  @IsNumber()
  readonly copiers: number;

  @IsOptional()
  @IsNumber()
  readonly accuracy?: number;

  @IsOptional()
  readonly metadata?: EventMetadata;

  constructor(data: {
    signalId: string;
    userId: string;
    performanceScore: number;
    returnPercentage: number;
    copiers: number;
    accuracy?: number;
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
      throw new Error(`Signal performance event validation failed: ${JSON.stringify(errors)}`);
    }

    if (this.copiers < 0) {
      throw new Error('Copiers count cannot be negative');
    }
  }
}

/**
 * Emitted when a signal is validated or rejected by AI
 */
export class SignalValidatedEvent extends BaseEvent {
  readonly eventName = 'signal.validated';

  @IsNotEmpty()
  @IsString()
  readonly signalId: string;

  @IsNotEmpty()
  @IsEnum(SignalStatus)
  readonly status: SignalStatus;

  @IsOptional()
  @IsString()
  readonly validationNotes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  readonly confidenceScore?: number;

  constructor(data: {
    signalId: string;
    status: SignalStatus;
    validationNotes?: string;
    confidenceScore?: number;
    correlationId?: string;
  }) {
    super(data.correlationId);
    Object.assign(this, data);
    this.validate();
  }

  validate(): void {
    const errors = validateSync(this);
    if (errors.length > 0) {
      throw new Error(`Signal validated event validation failed: ${JSON.stringify(errors)}`);
    }
  }
}