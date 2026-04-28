import { InputType, Field, Float } from '@nestjs/graphql';
import { IsOptional, IsString, IsEnum, IsNumber, IsArray } from 'class-validator';

export enum TradeStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
  PENDING = 'PENDING',
}

export enum TradeSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum TradeSortField {
  CREATED_AT = 'createdAt',
  CLOSED_AT = 'closedAt',
  PNL = 'pnl',
  SIZE = 'size',
}

export enum SortDirection {
  ASC = 'ASC',
  DESC = 'DESC',
}

@InputType()
export class TradeFilterInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  pair?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsEnum(TradeStatus, { each: true })
  statuses?: TradeStatus[];

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsEnum(TradeSide)
  side?: TradeSide;

  @Field(() => Float, { nullable: true, description: 'Min PnL in USD' })
  @IsOptional()
  @IsNumber()
  minPnl?: number;

  @Field(() => Float, { nullable: true, description: 'Max PnL in USD' })
  @IsOptional()
  @IsNumber()
  maxPnl?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  signalId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  openedAfter?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  closedBefore?: string;

  @Field(() => String, { nullable: true, defaultValue: TradeSortField.CREATED_AT })
  @IsOptional()
  @IsEnum(TradeSortField)
  sortBy?: TradeSortField = TradeSortField.CREATED_AT;

  @Field(() => String, { nullable: true, defaultValue: SortDirection.DESC })
  @IsOptional()
  @IsEnum(SortDirection)
  sortDir?: SortDirection = SortDirection.DESC;
}
