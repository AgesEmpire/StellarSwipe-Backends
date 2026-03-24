import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseExtractor, ExtractedRecord, ExtractionOptions } from './base.extractor';

@Injectable()
export class TradesExtractor extends BaseExtractor {
  readonly sourceName = 'trades';

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async extract(options: ExtractionOptions): Promise<ExtractedRecord[]> {
    const batchSize = options.batchSize ?? 1000;
    const rows: Array<{
      id: string;
      user_id: string;
      asset_pair: string;
      amount: string;
      price: string;
      status: string;
      created_at: string;
    }> = await this.dataSource.query(
      `SELECT id, user_id, asset_pair, amount, price, status, created_at
       FROM trades
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
        userId: row.user_id,
        assetPair: row.asset_pair,
        amount: parseFloat(row.amount),
        price: parseFloat(row.price),
        status: row.status,
      },
    }));
  }
}
