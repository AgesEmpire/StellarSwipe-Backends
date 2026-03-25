export class CoverageStatsDto {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
  uncoveredFiles: string[];
  collectedAt: Date;
}
