export class StepAnalysisDto {
  stepKey!: string;
  stepName!: string;
  order!: number;
  usersEntered!: number;
  usersCompleted!: number;
  conversionRate!: number;
  dropOffRate!: number;
}

export class FunnelAnalysisDto {
  funnelId!: string;
  funnelName!: string;
  totalUsersEntered!: number;
  totalUsersCompleted!: number;
  overallConversionRate!: number;
  steps!: StepAnalysisDto[];
  analyzedAt!: Date;
}
