import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum Timeframe {
  ONE_MINUTE = '1m',
  FIVE_MINUTES = '5m',
  FIFTEEN_MINUTES = '15m',
  ONE_HOUR = '1h',
  FOUR_HOURS = '4h',
  ONE_DAY = '1d',
  ONE_WEEK = '1w',
}

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  [Timeframe.ONE_MINUTE]: 60,
  [Timeframe.FIVE_MINUTES]: 300,
  [Timeframe.FIFTEEN_MINUTES]: 900,
  [Timeframe.ONE_HOUR]: 3600,
  [Timeframe.FOUR_HOURS]: 14400,
  [Timeframe.ONE_DAY]: 86400,
  [Timeframe.ONE_WEEK]: 604800,
};

export class OhlcvQueryDto {
  @IsEnum(Timeframe)
  @IsOptional()
  timeframe?: Timeframe = Timeframe.ONE_HOUR;

  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 100;
}
