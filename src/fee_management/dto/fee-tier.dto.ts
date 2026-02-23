import {
  IsEnum,
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeeTierType } from '../entities/fee-tier.entity';
import {
  PromotionStatus,
  PromotionType,
} from '../entities/fee-promotion.entity';

// ─────────────────────────────────────────────────────────────────────────────
// Fee Tier DTOs
// ─────────────────────────────────────────────────────────────────────────────

export class CreateFeeTierDto {
  @ApiProperty({ enum: FeeTierType })
  @IsEnum(FeeTierType)
  tierType!: FeeTierType;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsString()
  feeRate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  minVolume?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  maxVolume?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  minTrades?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresVip?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  sortOrder?: number;
}

export class UpdateFeeTierDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  feeRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  minVolume?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  maxVolume?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  minTrades?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresVip?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  sortOrder?: number;
}

export class FeeTierResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: FeeTierType })
  tierType!: FeeTierType;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  feeRate!: string;

  @ApiProperty()
  minVolume!: string;

  @ApiPropertyOptional()
  maxVolume?: string;

  @ApiProperty()
  minTrades!: number;

  @ApiProperty()
  requiresVip!: boolean;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Promotion DTOs
// ─────────────────────────────────────────────────────────────────────────────

export class CreatePromotionDto {
  @ApiProperty()
  @IsString()
  promoCode!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: PromotionType })
  @IsEnum(PromotionType)
  promotionType!: PromotionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  discountPercentage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fixedFeeRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  maxDiscount?: string;

  @ApiProperty()
  startDate!: Date;

  @ApiProperty()
  endDate!: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUsesPerUser?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  minTradeAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  applicableAssets?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eligibleUserIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresCode?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class UpdatePromotionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: PromotionType })
  @IsOptional()
  @IsEnum(PromotionType)
  promotionType?: PromotionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  discountPercentage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fixedFeeRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  maxDiscount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  startDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  endDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUsesPerUser?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  minTradeAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  applicableAssets?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eligibleUserIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresCode?: boolean;

  @ApiPropertyOptional({ enum: PromotionStatus })
  @IsOptional()
  @IsEnum(PromotionStatus)
  status?: PromotionStatus;
}

export class PromotionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  promoCode!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty({ enum: PromotionType })
  promotionType!: PromotionType;

  @ApiPropertyOptional()
  discountPercentage?: string;

  @ApiPropertyOptional()
  fixedFeeRate?: string;

  @ApiPropertyOptional()
  maxDiscount?: string;

  @ApiProperty()
  startDate!: Date;

  @ApiProperty()
  endDate!: Date;

  @ApiPropertyOptional()
  maxUses?: number;

  @ApiProperty()
  currentUses!: number;

  @ApiPropertyOptional()
  maxUsesPerUser?: number;

  @ApiPropertyOptional()
  minTradeAmount?: string;

  @ApiPropertyOptional()
  applicableAssets?: string;

  @ApiProperty()
  requiresCode!: boolean;

  @ApiProperty({ enum: PromotionStatus })
  status!: PromotionStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class CheckEligibilityDto {
  @ApiProperty()
  @IsString()
  promoCode!: string;

  @ApiProperty()
  @IsString()
  userId!: string;

  @ApiProperty()
  @IsString()
  tradeAmount!: string;

  @ApiProperty()
  @IsString()
  assetCode!: string;
}

export class CheckEligibilityResponseDto {
  @ApiProperty()
  eligible!: boolean;

  @ApiPropertyOptional()
  reason?: string;

  @ApiPropertyOptional()
  promotion?: PromotionResponseDto;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fee Schedule DTOs
// ─────────────────────────────────────────────────────────────────────────────

export class FeeScheduleDto {
  @ApiProperty()
  @IsString()
  periodStart!: string;

  @ApiProperty()
  @IsString()
  periodEnd!: string;

  @ApiProperty()
  @ApiProperty({ type: [FeeTierResponseDto] })
  tiers!: FeeTierResponseDto[];

  @ApiProperty({ type: [PromotionResponseDto] })
  activePromotions!: PromotionResponseDto[];
}

export class RevenueForecastDto {
  @ApiProperty()
  period!: string;

  @ApiProperty()
  projectedVolume!: string;

  @ApiProperty()
  projectedFees!: string;

  @ApiProperty()
  projectedPromotions!: string;

  @ApiProperty()
  netRevenue!: string;

  @ApiProperty({ type: [String] })
  assumptions!: string[];
}

export class TierVolumeStatsDto {
  @ApiProperty({ enum: FeeTierType })
  tierType!: FeeTierType;

  @ApiProperty()
  userCount!: number;

  @ApiProperty()
  totalVolume!: string;

  @ApiProperty()
  totalFees!: string;

  @ApiProperty()
  averageFeeRate!: string;
}
