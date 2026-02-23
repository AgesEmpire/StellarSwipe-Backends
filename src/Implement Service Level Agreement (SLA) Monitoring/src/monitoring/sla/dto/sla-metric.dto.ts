import { IsString, IsNumber, IsBoolean, IsOptional, Min } from 'class-validator';

export class RecordMetricDto {
  @IsString()
  service: string;

  @IsNumber()
  @Min(0)
  responseTime: number;

  @IsBoolean()
  isAvailable: boolean;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class SetThresholdDto {
  @IsString()
  service: string;

  @IsNumber()
  @Min(0)
  maxResponseTime: number;

  @IsNumber()
  @Min(0)
  minUptimePercentage: number;
}
