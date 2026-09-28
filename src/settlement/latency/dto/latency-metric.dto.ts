import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class LatencyMetricDto {
  @IsString()
  @IsNotEmpty()
  tradeId!: string;

  @IsDateString()
  executedAt!: string;

  @IsDateString()
  settledAt!: string;

  @IsNumber()
  @Min(0)
  latencyMs!: number;

  @IsString()
  @IsOptional()
  assetPair?: string;
}
