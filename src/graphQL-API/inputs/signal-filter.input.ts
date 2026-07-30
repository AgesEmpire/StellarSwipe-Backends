import { InputType, Field, Float } from '@nestjs/graphql';
import { IsOptional, IsString, IsEnum, IsNumber, IsArray } from 'class-validator';

export enum SignalStatus {
  ACTIVE = 'ACTIVE',
  TRIGGERED = 'TRIGGERED',
  CLOSED = 'CLOSED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum SignalType {
  BUY = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD',
}

export enum SignalSortField {
  CREATED_AT = 'createdAt',
  CONFIDENCE = 'confidence',
  RISK_REWARD = 'riskRewardRatio',
}

export enum SortDirection {
  ASC = 'ASC',
  DESC = 'DESC',
}

@InputType()
export class SignalFilterInput {
  /** Filter by asset pair, e.g. "XLM/USDC" */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  pair?: string;

  /** Filter by one or more signal statuses */
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsEnum(SignalStatus, { each: true })
  statuses?: SignalStatus[];

  /** Filter by signal direction */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsEnum(SignalType)
  type?: SignalType;

  /** Filter by provider ID */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  providerId?: string;

  /** Only signals with confidence above this threshold (0–1) */
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  minConfidence?: number;

  /** Filter signals created after this ISO-8601 timestamp */
  @Field(() => String, { nullable: true })
  @IsOptional()
  createdAfter?: string;

  /** Filter signals expiring before this ISO-8601 timestamp */
  @Field(() => String, { nullable: true })
  @IsOptional()
  expiresBeforeI?: string;

  @Field(() => String, { nullable: true, defaultValue: SignalSortField.CREATED_AT })
  @IsOptional()
  @IsEnum(SignalSortField)
  sortBy?: SignalSortField = SignalSortField.CREATED_AT;

  @Field(() => String, { nullable: true, defaultValue: SortDirection.DESC })
  @IsOptional()
  @IsEnum(SortDirection)
  sortDir?: SortDirection = SortDirection.DESC;
}
