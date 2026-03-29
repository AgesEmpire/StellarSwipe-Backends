export class DropOffPoint {
  stepKey!: string;
  stepName!: string;
  dropOffCount!: number;
  dropOffRate!: number;
}

export class ConversionReportDto {
  funnelName!: string;
  period!: { from: string; to: string };
  totalUsers!: number;
  convertedUsers!: number;
  overallConversionRate!: number;
  dropOffPoints!: DropOffPoint[];
  avgTimeToConvert?: number;
}
