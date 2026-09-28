import {
  IsString,
  IsBoolean,
  IsOptional,
  IsEnum,
  IsObject,
  MaxLength,
  MinLength,
  Matches,
  IsDateString,
} from 'class-validator';
import { RegionFlagStatus } from '../entities/regional-flag-config.entity';

export class CreateRegionalFlagDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  flagName!: string;

  @IsString()
  @Matches(/^[A-Z]{2}(-[A-Z0-9]{2,3})?$|^GLOBAL$|^[A-Z]{2,6}$/, {
    message: 'region must be ISO 3166-1 alpha-2, a macro-region code (EU, APAC, LATAM), or GLOBAL',
  })
  region!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsEnum(RegionFlagStatus)
  status?: RegionFlagStatus;

  @IsOptional()
  @IsObject()
  overrides?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  enabledAt?: string;

  @IsOptional()
  @IsDateString()
  disabledAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class UpdateRegionalFlagDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(RegionFlagStatus)
  status?: RegionFlagStatus;

  @IsOptional()
  @IsObject()
  overrides?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  enabledAt?: string;

  @IsOptional()
  @IsDateString()
  disabledAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class RegionalFlagQueryDto {
  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  flagName?: string;

  @IsOptional()
  @IsEnum(RegionFlagStatus)
  status?: RegionFlagStatus;
}

export class BulkEvaluateRegionalFlagsDto {
  @IsString({ each: true })
  flagNames!: string[];

  @IsString()
  region!: string;

  @IsObject()
  globalFlags!: Record<string, boolean>;
}

export interface RegionalFlagEvaluationResult {
  flagName: string;
  region: string;
  enabled: boolean;
  overrides: Record<string, unknown>;
  resolvedFrom: 'regional' | 'global' | 'default';
}
