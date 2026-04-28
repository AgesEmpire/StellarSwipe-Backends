import { IsNumber, IsArray, IsDate, IsOptional, ValidateNested, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class RevenueBreakdownDto {
  @IsString()
  source: string; // 'trading', 'signals', 'api', 'subscriptions', etc.

  @IsNumber()
  amount: number;

  @IsNumber()
  percentage: number;
}

export class RevenueTimeSeriesDto {
  @IsDate()
  @Type(() => Date)
  timestamp: Date;

  @IsNumber()
  amount: number;

  @IsString()
  period: string; // 'hourly', 'daily', 'weekly', 'monthly'
}

export class RevenueMetricsDto {
  @IsNumber()
  totalRevenue: number;

  @IsNumber()
  dailyRevenue: number;

  @IsNumber()
  weeklyRevenue: number;

  @IsNumber()
  monthlyRevenue: number;

  @IsNumber()
  averageRevenuePerUser: number;

  @IsNumber()
  revenueGrowthDaily: number; // Percentage

  @IsNumber()
  revenueGrowthWeekly: number; // Percentage

  @IsNumber()
  revenueGrowthMonthly: number; // Percentage

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RevenueBreakdownDto)
  breakdown: RevenueBreakdownDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RevenueTimeSeriesDto)
  timeSeries: RevenueTimeSeriesDto[];

  @IsNumber()
  @IsOptional()
  projectedMonthlyRevenue: number;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  lastUpdated: Date;
}
