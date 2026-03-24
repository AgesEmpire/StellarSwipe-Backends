import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseExtractor, ExtractedRecord, ExtractionOptions } from './base.extractor';

@Injectable()
export class SignalsExtractor extends BaseExtractor {
  readonly sourceName = 'signals';

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async extract(options: ExtractionOptions): Promise<ExtractedRecord[]> {
    const batchSize = options.batchSize ?? 1000;
    const rows: Array<{
      id: string;
      provider_id: string;
      asset_pair: string;
      action: string;
      confidence: string;
      created_at: string;
      metadata: Record<string, unknown>;
    }> = await this.dataSource.query(
      `SELECT id, provider_id, asset_pair, action, confidence, created_at, metadata
       FROM signals
       WHERE created_at >= $1 AND created_at < $2
       ORDER BY created_at ASC
       LIMIT $3`,
      [options.startDate, options.endDate, batchSize],
    );

    return rows.map((row) => ({
      id: row.id,
      timestamp: new Date(row.created_at),
      source: this.sourceName,
      data: {
        providerId: row.provider_id,
        assetPair: row.asset_pair,
        action: row.action,
        confidence: parseFloat(row.confidence),
        metadata: row.metadata ?? {},
      },
    }));
  }
}
