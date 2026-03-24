import { IsEnum, IsString, IsNumber } from 'class-validator';
import { MetricType } from '../entities/sla-metric.entity';
import { ViolationSeverity } from '../entities/sla-violation.entity';

export class ViolationAlertDto {
  @IsString()
  agreementId!: string;

  @IsString()
  clientName!: string;

  @IsEnum(MetricType)
  metricType!: MetricType;

  @IsEnum(ViolationSeverity)
  severity!: ViolationSeverity;

  @IsNumber()
  thresholdValue!: number;

  @IsNumber()
  actualValue!: number;

  @IsString()
  message!: string;

  detectedAt!: Date;
}
