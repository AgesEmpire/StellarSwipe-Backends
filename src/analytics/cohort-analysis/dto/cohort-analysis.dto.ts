export interface CohortBucketDto {
  cohortKey: string;
  cohortType: string;
  cohortSize: number;
  activeUsersByPeriod: number[];
  retentionRates: number[];
}

export interface CohortAnalysisDto {
  generatedAt: string;
  period: 'day' | 'week' | 'month';
  retentionPeriods: number;
  cohorts: CohortBucketDto[];
}
