import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CohortType } from '../interfaces/cohort-config.interface';

enum CohortTypeEnum {
  SIGNUP_PERIOD = 'signup_period',
  FIRST_TRADE_PERIOD = 'first_trade_period',
  PROVIDER_FOLLOWED = 'provider_followed',
}

enum CohortPeriodEnum {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class CohortQueryDto {
  @IsOptional()
  @IsEnum(CohortTypeEnum)
  cohortType?: CohortType;

  @IsOptional()
  @IsEnum(CohortPeriodEnum)
  period?: 'day' | 'week' | 'month';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  lookbackPeriods?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  retentionPeriods?: number;

  @IsOptional()
  @IsUUID()
  providerId?: string;
}
