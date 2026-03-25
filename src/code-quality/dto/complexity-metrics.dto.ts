export class ComplexityMetricsDto {
  averageCyclomaticComplexity: number;
  maxCyclomaticComplexity: number;
  highComplexityFiles: { file: string; complexity: number }[];
  technicalDebtMinutes: number;
  collectedAt: Date;
}
