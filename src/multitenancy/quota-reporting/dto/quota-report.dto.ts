export class QuotaMetricReportDto {
  usageType!: string;
  unit!: string;
  used!: number;
  quota!: number;
  remaining!: number;
  forecastedQuota!: number;
  forecastedUsage!: number;
  forecastedRemaining!: number;
  utilizationPercentage!: number;
  forecastedUtilizationPercentage!: number;
}

export class QuotaReportDto {
  tenantId!: string;
  periodStart!: string;
  periodEnd!: string;
  generatedAt!: string;
  metrics!: QuotaMetricReportDto[];
}
