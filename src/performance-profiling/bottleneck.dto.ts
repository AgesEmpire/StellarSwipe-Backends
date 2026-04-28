export enum BottleneckSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum BottleneckCategory {
  CPU = 'cpu',
  MEMORY = 'memory',
  QUERY = 'query',
  API = 'api',
  IO = 'io',
}

export class BottleneckDto {
  category: BottleneckCategory;
  severity: BottleneckSeverity;
  title: string;
  description: string;
  detectedAt: Date;
  metric: string;
  observedValue: number;
  threshold: number;
  unit: string;
  recommendation: string;
  affectedResource?: string;
  occurrences?: number;
  sampleData?: Record<string, any>;
}
