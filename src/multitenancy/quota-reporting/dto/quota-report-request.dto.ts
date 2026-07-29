import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class QuotaReportRequestDto {
  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  forecastDays?: number;
}
