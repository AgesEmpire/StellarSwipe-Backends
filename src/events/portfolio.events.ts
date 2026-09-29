import { BaseEvent, EventMetadata } from './base.event';
import { IsNotEmpty, IsOptional, IsString, validateSync } from 'class-validator';

export class PortfolioTransactionCreatedEvent extends BaseEvent {
  readonly eventName = 'portfolio.transaction.created';

  @IsNotEmpty()
  @IsString()
  readonly tradeId!: string;

  @IsNotEmpty()
  @IsString()
  readonly userId!: string;

  @IsNotEmpty()
  @IsString()
  readonly signalId!: string;

  @IsNotEmpty()
  @IsString()
  readonly baseAsset!: string;

  @IsNotEmpty()
  @IsString()
  readonly counterAsset!: string;

  @IsNotEmpty()
  @IsString()
  readonly amount!: string;

  @IsNotEmpty()
  @IsString()
  readonly entryPrice!: string;

  @IsNotEmpty()
  @IsString()
  readonly totalValue!: string;

  @IsString()
  @IsOptional()
  readonly feeAmount?: string;

  @IsNotEmpty()
  @IsString()
  readonly status!: string;

  @IsOptional()
  readonly metadata?: EventMetadata;

  constructor(data: {
    tradeId: string;
    userId: string;
    signalId: string;
    baseAsset: string;
    counterAsset: string;
    amount: string;
    entryPrice: string;
    totalValue: string;
    feeAmount?: string;
    status: string;
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
      throw new Error(`Portfolio transaction event validation failed: ${JSON.stringify(errors)}`);
    }
  }
}

/**
 * Emitted when a portfolio should be created for a user. `eventId` is the
 * delivery-stable identifier used to make persistence idempotent.
 */
export class PortfolioCreatedEvent extends BaseEvent {
  readonly eventName = 'portfolio.created';

  @IsNotEmpty()
  @IsString()
  readonly eventId!: string;

  @IsNotEmpty()
  @IsString()
  readonly userId!: string;

  @IsNotEmpty()
  @IsString()
  readonly baseCurrency!: string;

  @IsOptional()
  @IsString()
  readonly name?: string;

  @IsOptional()
  readonly initialMetadata?: Record<string, unknown>;

  constructor(data: {
    eventId: string;
    userId: string;
    baseCurrency: string;
    name?: string;
    initialMetadata?: Record<string, unknown>;
    correlationId?: string;
  }) {
    super(data.correlationId);
    Object.assign(this, data);
    this.validate();
  }

  validate(): void {
    const errors = validateSync(this);
    if (errors.length > 0) {
      throw new Error(`Portfolio created event validation failed: ${JSON.stringify(errors)}`);
    }
  }
}
