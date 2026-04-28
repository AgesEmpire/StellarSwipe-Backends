import { IsNumber, IsOptional, IsDate, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class KpiSummaryDto {
  @IsNumber()
  @IsPositive()
  activeUsers: number;

  @IsNumber()
  @IsPositive()
  totalRevenue: number;

  @IsNumber()
  revenueGrowth: number; // Percentage change

  @IsNumber()
  @IsPositive()
  totalTrades: number;

  @IsNumber()
  tradeVolumeGrowth: number; // Percentage change

  @IsNumber()
  @IsPositive()
  activeSignals: number;

  @IsNumber()
  signalSuccessRate: number; // Percentage (0-100)

  @IsNumber()
  platformUptime: number; // Percentage (0-100)

  @IsNumber()
  @IsPositive()
  totalUsers: number;

  @IsNumber()
  newUsersToday: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  lastUpdated: Date;

  @IsNumber()
  @IsOptional()
  averageTradeSize: number;

  @IsNumber()
  @IsOptional()
  totalFees: number;

  @IsNumber()
  @IsOptional()
  systemHealth: number; // 0-100
}
