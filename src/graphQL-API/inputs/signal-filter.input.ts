import { InputType, Field, Float } from '@nestjs/graphql';
import { IsOptional, IsEnum, IsArray } from 'class-validator';
import {
  NullableString,
  NullableBoundedNumber,
  NullableEnum,
  NullableIsoDate,
} from '../../common/validation/constraints/common-constraints.decorators';

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
  @NullableString(32)
  pair?: string;

  /** Filter by one or more signal statuses */
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsEnum(SignalStatus, { each: true })
  statuses?: SignalStatus[];

  /** Filter by signal direction */
  @Field(() => String, { nullable: true })
  @NullableEnum(SignalType)
  type?: SignalType;

  /** Filter by provider ID */
  @Field(() => String, { nullable: true })
  @NullableString(64)
  providerId?: string;

  /** Only signals with confidence above this threshold (0–1) */
  @Field(() => Float, { nullable: true })
  @NullableBoundedNumber(0, 1)
  minConfidence?: number;

  /** Filter signals created after this ISO-8601 timestamp */
  @Field(() => String, { nullable: true })
  @NullableIsoDate()
  createdAfter?: string;

  /** Filter signals expiring before this ISO-8601 timestamp */
  @Field(() => String, { nullable: true })
  @NullableIsoDate()
  expiresBeforeI?: string;

  @Field(() => String, { nullable: true, defaultValue: SignalSortField.CREATED_AT })
  @NullableEnum(SignalSortField)
  sortBy?: SignalSortField = SignalSortField.CREATED_AT;

  @Field(() => String, { nullable: true, defaultValue: SortDirection.DESC })
  @NullableEnum(SortDirection)
  sortDir?: SortDirection = SortDirection.DESC;
}
