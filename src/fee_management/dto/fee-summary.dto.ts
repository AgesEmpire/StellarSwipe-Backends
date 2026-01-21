import { IsEnum, IsOptional, IsDateString, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeeTier, FeeStatus } from '../entities/fee-transaction.entity';

export class FeeSummaryDto {
  @ApiProperty({ description: 'Total fees collected in the period' })
  totalFeesCollected!: string;

  @ApiProperty({ description: 'Total trade volume in the period' })
  totalTradeVolume!: string;

  @ApiProperty({ description: 'Number of fee transactions' })
  transactionCount!: number;

  @ApiProperty({ description: 'Average fee per transaction' })
  averageFee!: string;

  @ApiProperty({ description: 'Failed fee collection count' })
  failedCollections!: number;

  @ApiProperty({ description: 'Pending fee collection count' })
  pendingCollections!: number;

  @ApiProperty({ description: 'Fee breakdown by tier' })
  feesByTier!: {
    [key in FeeTier]?: {
      count: number;
      totalFees: string;
      totalVolume: string;
    };
  };

  @ApiProperty({ description: 'Fee breakdown by asset' })
  feesByAsset!: {
    [assetCode: string]: {
      count: number;
      totalFees: string;
      totalVolume: string;
    };
  };

  @ApiProperty({ description: 'Period start date' })
  periodStart!: Date;

  @ApiProperty({ description: 'Period end date' })
  periodEnd!: Date;
}

export class UserFeeSummaryDto {
  @ApiProperty({ description: 'User ID' })
  userId!: string;

  @ApiProperty({ description: 'Total fees paid by user' })
  totalFeesPaid!: string;

  @ApiProperty({ description: 'User trade volume' })
  totalTradeVolume!: string;

  @ApiProperty({ description: 'Number of trades' })
  tradeCount!: number;

  @ApiProperty({ description: 'Current fee tier' })
  currentFeeTier!: FeeTier;

  @ApiProperty({ description: 'Current fee rate' })
  currentFeeRate!: string;

  @ApiProperty({ description: 'Monthly volume for tier calculation' })
  monthlyVolume!: string;

  @ApiProperty({ description: 'Fees saved compared to standard rate' })
  feesSaved?: string;
}

export class FeeCalculationDto {
  @ApiProperty({ description: 'Trade amount before fees' })
  tradeAmount!: string;

  @ApiProperty({ description: 'Calculated fee amount' })
  feeAmount!: string;

  @ApiProperty({ description: 'Applied fee rate' })
  feeRate!: string;

  @ApiProperty({ description: 'Fee tier applied' })
  feeTier!: FeeTier;

  @ApiProperty({ description: 'Net amount after fee deduction' })
  netAmount!: string;

  @ApiProperty({ description: 'Asset code' })
  assetCode!: string;
}

export class GetFeeHistoryDto {
  @ApiPropertyOptional({ description: 'User ID to filter by' })
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({ description: 'Start date for filtering' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date for filtering' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Fee status filter', enum: FeeStatus })
  @IsOptional()
  @IsEnum(FeeStatus)
  status?: FeeStatus;

  @ApiPropertyOptional({ description: 'Fee tier filter', enum: FeeTier })
  @IsOptional()
  @IsEnum(FeeTier)
  feeTier?: FeeTier;

  @ApiPropertyOptional({ description: 'Page number', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', minimum: 1, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 50;
}

export class FeeConfigDto {
  @ApiProperty({ description: 'Standard fee rate', example: '0.001' })
  standardRate!: string;

  @ApiProperty({ description: 'High volume fee rate', example: '0.0008' })
  highVolumeRate!: string;

  @ApiProperty({ description: 'VIP fee rate', example: '0.0005' })
  vipRate!: string;

  @ApiProperty({ description: 'High volume threshold', example: '10000' })
  highVolumeThreshold!: string;

  @ApiProperty({ description: 'Platform wallet address' })
  platformWalletAddress!: string;
}

export class MonthlyRevenueReportDto {
  @ApiProperty({ description: 'Report year' })
  year!: number;

  @ApiProperty({ description: 'Report month (1-12)' })
  month!: number;

  @ApiProperty({ description: 'Total revenue collected' })
  totalRevenue!: string;

  @ApiProperty({ description: 'Total trade volume' })
  totalVolume!: string;

  @ApiProperty({ description: 'Number of transactions' })
  transactionCount!: number;

  @ApiProperty({ description: 'Number of unique users' })
  uniqueUsers!: number;

  @ApiProperty({ description: 'Revenue by tier' })
  revenueByTier!: {
    [key in FeeTier]?: string;
  };

  @ApiProperty({ description: 'Revenue by asset' })
  revenueByAsset!: {
    [assetCode: string]: string;
  };

  @ApiProperty({ description: 'Top fee-paying users' })
  topUsers!: Array<{
    userId: string;
    totalFees: string;
    tradeCount: number;
  }>;

  @ApiProperty({ description: 'Failed collections total' })
  failedCollectionsTotal!: string;

  @ApiProperty({ description: 'Average fee per transaction' })
  averageFeePerTransaction!: string;
}