import { IsEnum, IsOptional, IsBoolean, IsObject } from 'class-validator';
import { ComplianceRegion } from '../interfaces/compliance-framework.interface';

export class RegionConfigDto {
  @IsEnum(ComplianceRegion)
  region!: ComplianceRegion;

  @IsOptional()
  @IsBoolean()
  strictMode?: boolean;

  @IsOptional()
  @IsObject()
  overrides?: Record<string, boolean>;
}
