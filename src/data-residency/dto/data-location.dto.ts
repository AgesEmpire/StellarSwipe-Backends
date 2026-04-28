import {
  IsString,
  IsEnum,
  IsOptional,
  IsUUID,
  IsArray,
  IsBoolean,
} from 'class-validator';
import { RegionCode } from '../entities/data-region.entity';

export class DataLocationDto {
  @IsUUID()
  userId: string;

  @IsEnum(RegionCode)
  currentRegion: RegionCode;

  @IsEnum(RegionCode)
  @IsOptional()
  requestedRegion?: RegionCode;

  @IsString()
  @IsOptional()
  countryCode?: string;

  @IsBoolean()
  @IsOptional()
  forceMigration?: boolean;
}

export class DataLocationResponseDto {
  @IsUUID()
  userId: string;

  @IsEnum(RegionCode)
  assignedRegion: RegionCode;

  @IsString()
  storageEndpoint: string;

  @IsBoolean()
  migrationRequired: boolean;

  @IsArray()
  @IsOptional()
  applicablePolicies?: string[];
}

export class MigrateDataLocationDto {
  @IsUUID()
  userId: string;

  @IsEnum(RegionCode)
  sourceRegion: RegionCode;

  @IsEnum(RegionCode)
  targetRegion: RegionCode;

  @IsString()
  @IsOptional()
  reason?: string;
}
