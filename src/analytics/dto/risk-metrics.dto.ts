import { IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RiskMetricsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  days?: number = 90;
}

export class RiskMetricsResponseDto {
  sharpeRatio: number;
  maxDrawdown: number;
  currentDrawdown: number;
  volatility: number;
  valueAtRisk95: number;
  beta: number;
  calculationPeriod: {
    start: Date;
    end: Date;
  };
}
