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

// RFC 3339 timestamp with a mandatory timezone offset or Z designator.
// Rejects ambiguous local timestamps (no offset) and unsupported precision
// (fractional seconds beyond milliseconds).
const RFC3339_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Parse an RFC 3339 timestamp that carries an explicit offset (or Z) and
 * normalize it to a UTC Date. Returns null for ambiguous or invalid input.
 */
export function parseRfc3339ToUtc(value: unknown): Date | null {
  if (typeof value !== 'string' || !RFC3339_WITH_OFFSET.test(value)) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

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

  @IsOptional()
  @Type(() => String)
  from?: string;

  @IsOptional()
  @Type(() => String)
  to?: string;
}
