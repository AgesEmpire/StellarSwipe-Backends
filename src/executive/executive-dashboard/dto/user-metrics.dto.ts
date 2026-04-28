import { IsNumber, IsArray, IsDate, IsOptional, ValidateNested, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class UserCohortDto {
  @IsString()
  name: string; // 'Today', 'Last 7 days', 'Last 30 days', etc.

  @IsNumber()
  count: number;

  @IsNumber()
  growthRate: number; // Percentage
}

export class UserEngagementDto {
  @IsString()
  metric: string; // 'daily_active', 'weekly_active', 'monthly_active'

  @IsNumber()
  value: number;

  @IsNumber()
  percentage: number; // Percentage of total users
}

export class UserMetricsDto {
  @IsNumber()
  totalUsers: number;

  @IsNumber()
  activeUsers: number;

  @IsNumber()
  newUsersToday: number;

  @IsNumber()
  newUsersThisWeek: number;

  @IsNumber()
  newUsersThisMonth: number;

  @IsNumber()
  userGrowthDaily: number; // Percentage

  @IsNumber()
  userGrowthWeekly: number; // Percentage

  @IsNumber()
  userGrowthMonthly: number; // Percentage

  @IsNumber()
  churnRate: number; // Percentage

  @IsNumber()
  retentionRate: number; // Percentage

  @IsNumber()
  averageSessionDuration: number; // In seconds

  @IsNumber()
  dailyActiveUsers: number;

  @IsNumber()
  weeklyActiveUsers: number;

  @IsNumber()
  monthlyActiveUsers: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserCohortDto)
  cohorts: UserCohortDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserEngagementDto)
  engagement: UserEngagementDto[];

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  lastUpdated: Date;
}
