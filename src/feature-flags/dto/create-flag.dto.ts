import { IsString, IsEnum, IsBoolean, IsOptional, ValidateNested, IsNumber, Min, Max, IsArray, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { FlagType } from '../entities/feature-flag.entity';

class VariantDto {
  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  percentage!: number;
}

class FlagConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userList?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  @ArrayMinSize(1)
  variants?: VariantDto[];
}

export class CreateFlagDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(['boolean', 'percentage', 'userList', 'abTest'])
  type!: FlagType;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => FlagConfigDto)
  config?: FlagConfigDto;
}

export class UpdateFlagDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => FlagConfigDto)
  config?: FlagConfigDto;
}
