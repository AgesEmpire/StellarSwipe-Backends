import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CampaignMetricsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  granularity?: 'day' | 'week' | 'month';
}

export interface CampaignMetricsSummary {
  campaignId: string;
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
  totalRevenue: number;
  totalSpend: number;
  averageCtr: number;
  averageConversionRate: number;
  roi: number;
}
