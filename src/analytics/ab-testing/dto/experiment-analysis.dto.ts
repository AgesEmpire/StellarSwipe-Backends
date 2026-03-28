import { IsString, IsArray, IsNumber, IsOptional, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class VariantDataDto {
  @IsString()
  variantId!: string;

  @IsString()
  name!: string;

  @IsNumber()
  @Min(1)
  impressions!: number;

  @IsNumber()
  @Min(0)
  conversions!: number;

  @IsNumber()
  @IsOptional()
  mean?: number;

  @IsNumber()
  @IsOptional()
  stdDev?: number;
}

export class ExperimentAnalysisDto {
  @IsString()
  experimentId!: string;

  @IsString()
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantDataDto)
  variants!: VariantDataDto[];

  @IsNumber()
  @Min(0.8)
  @Max(0.99)
  @IsOptional()
  confidenceLevel?: number = 0.95;
}
