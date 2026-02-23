import { IsArray, IsEnum, IsNotEmpty, ArrayMinSize } from 'class-validator';

export enum ComparisonMetric {
  WIN_RATE = 'winRate',
  TOTAL_PNL = 'totalPnL',
  CONSISTENCY = 'consistency',
  FOLLOWERS = 'followers',
}

export enum ComparisonTimeframe {
  THIRTY_DAYS = '30d',
  NINETY_DAYS = '90d',
  ALL = 'all',
}

export class CompareProvidersDto {
  @IsArray()
  @ArrayMinSize(2)
  @IsNotEmpty()
  providerIds: string[];

  @IsArray()
  @IsEnum(ComparisonMetric, { each: true })
  metrics: ComparisonMetric[];

  @IsEnum(ComparisonTimeframe)
  timeframe: ComparisonTimeframe;
}
