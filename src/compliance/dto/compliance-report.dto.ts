import { IsEnum, IsDateString, IsOptional } from 'class-validator';

export enum ReportType {
  TRADE_VOLUME = 'trade_volume',
  AML_RISK = 'aml_risk',
  USER_ACTIVITY = 'user_activity',
  FINANCIAL_SUMMARY = 'financial_summary',
}

export class ComplianceReportDto {
  @IsEnum(ReportType)
  type: ReportType;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  includeAnonymized?: boolean = true;
}
