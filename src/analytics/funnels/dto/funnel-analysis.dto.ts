import { IsString, IsOptional, IsDateString } from 'class-validator';

export class FunnelAnalysisDto {
  @IsString()
  funnelName!: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class FunnelStepAnalysis {
  stepKey!: string;
  stepName!: string;
  stepOrder!: number;
  usersReached!: number;
  conversionRate!: number;
  dropOffRate!: number;
}

export class FunnelAnalysisResult {
  funnelName!: string;
  totalEntries!: number;
  totalConversions!: number;
  overallConversionRate!: number;
  steps!: FunnelStepAnalysis[];
  period?: { from: string; to: string };
}
