import { IsString, IsArray, IsOptional, IsInt, Min, Max, MaxLength } from 'class-validator';

export class FallbackConfigDto {
  @IsString()
  @MaxLength(50)
  primarySource!: string;

  @IsArray()
  @IsString({ each: true })
  fallbackSources!: string[];

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(30000)
  timeoutMs?: number;
}

export class PricingSourceResultDto {
  source!: string;
  price!: number;
  timestamp!: Date;
  isFallback!: boolean;
}
