export interface ExtractedRecord {
  id: string;
  timestamp: Date;
  source: string;
  data: Record<string, unknown>;
}

export interface ExtractionOptions {
  startDate: Date;
  endDate: Date;
  batchSize?: number;
}

export abstract class BaseExtractor {
  abstract readonly sourceName: string;
  abstract extract(options: ExtractionOptions): Promise<ExtractedRecord[]>;
}
