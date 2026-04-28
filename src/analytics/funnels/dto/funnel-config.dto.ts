import { IsString, IsArray, ValidateNested, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class FunnelStepDto {
  @IsString()
  key!: string;

  @IsString()
  name!: string;

  @IsInt()
  @Min(0)
  order!: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class FunnelConfigDto {
  @IsString()
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FunnelStepDto)
  steps!: FunnelStepDto[];
}
