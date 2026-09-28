import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  IsDateString,
  IsNumber,
  IsPositive,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';
import { CampaignStatus, CampaignType } from '../entities/campaign.entity';

export class CreateCampaignDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(10)
  region!: string;

  @IsEnum(CampaignType)
  type!: CampaignType;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  budget?: number;

  @IsOptional()
  @IsObject()
  localizedContent?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  localizedPricing?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  budget?: number;

  @IsOptional()
  @IsObject()
  localizedContent?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  localizedPricing?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CampaignQueryDto {
  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @IsOptional()
  @IsEnum(CampaignType)
  type?: CampaignType;
}
