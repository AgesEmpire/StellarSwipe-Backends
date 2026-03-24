import { IsOptional, IsDateString, IsEnum } from 'class-validator';
import { SlaTierName } from '../interfaces/sla-tier.interface';

export class SlaReportDto {
  agreementId!: string;
  userId!: string;
  clientName!: string;
  tier!: SlaTierName;
  periodStart!: Date;
  periodEnd!: Date;
  uptimePercent!: number;
  avgResponseTimeMs!: number;
  p95ResponseTimeMs!: number;
  errorRatePercent!: number;
  avgThroughputRpm!: number;
  totalViolations!: number;
  breachCount!: number;
  slaCompliant!: boolean;
}

export class SlaReportQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(SlaTierName)
  tier?: SlaTierName;
}
