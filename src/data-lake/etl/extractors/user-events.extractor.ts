import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseExtractor, ExtractedRecord, ExtractionOptions } from './base.extractor';

@Injectable()
export class UserEventsExtractor extends BaseExtractor {
  readonly sourceName = 'user_events';

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async extract(options: ExtractionOptions): Promise<ExtractedRecord[]> {
    const batchSize = options.batchSize ?? 1000;
    const rows: Array<{
      id: string;
      user_id: string;
      event_type: string;
      occurred_at: string;
      metadata: Record<string, unknown>;
    }> = await this.dataSource.query(
      `SELECT id, user_id, event_type, occurred_at, metadata
       FROM user_events
       WHERE occurred_at >= $1 AND occurred_at < $2
       ORDER BY occurred_at ASC
       LIMIT $3`,
      [options.startDate, options.endDate, batchSize],
    );

    return rows.map((row) => ({
      id: row.id,
      timestamp: new Date(row.occurred_at),
      source: this.sourceName,
      data: {
        userId: row.user_id,
        eventType: row.event_type,
        metadata: row.metadata ?? {},
      },
    }));
  }
}
