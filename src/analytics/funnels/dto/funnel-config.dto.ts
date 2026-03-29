import { IsString, IsArray, ValidateNested, IsInt, Min, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

class FunnelStepDto {
  @IsString()
  key!: string;

  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  order!: number;
}

export class FunnelConfigDto {
  @IsString()
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FunnelStepDto)
  steps!: FunnelStepDto[];
}

export class TrackFunnelStepDto {
  @IsString()
  userId!: string;

  @IsString()
  funnelName!: string;

  @IsString()
  stepKey!: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
