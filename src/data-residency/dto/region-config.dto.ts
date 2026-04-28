import {
  IsString,
  IsEnum,
  IsArray,
  IsOptional,
  IsBoolean,
  IsObject,
  MaxLength,
  ArrayNotEmpty,
} from 'class-validator';
import { RegionCode, RegionStatus } from '../entities/data-region.entity';

export class CreateRegionConfigDto {
  @IsEnum(RegionCode)
  code: RegionCode;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(500)
  storageEndpoint: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  countryCodes: string[];

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  complianceFrameworks?: string[];

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdateRegionConfigDto {
  @IsString()
  @MaxLength(500)
  @IsOptional()
  storageEndpoint?: string;

  @IsEnum(RegionStatus)
  @IsOptional()
  status?: RegionStatus;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  countryCodes?: string[];

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  complianceFrameworks?: string[];

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class RegionConfigResponseDto {
  @IsString()
  id: string;

  @IsEnum(RegionCode)
  code: RegionCode;

  @IsString()
  name: string;

  @IsString()
  storageEndpoint: string;

  @IsArray()
  countryCodes: string[];

  @IsEnum(RegionStatus)
  status: RegionStatus;

  @IsArray()
  @IsOptional()
  complianceFrameworks?: string[];

  @IsBoolean()
  isOperational: boolean;
}
