import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseExtractor, ExtractedRecord, ExtractionOptions } from './base.extractor';

@Injectable()
export class PositionsExtractor extends BaseExtractor {
  readonly sourceName = 'positions';

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async extract(options: ExtractionOptions): Promise<ExtractedRecord[]> {
    const batchSize = options.batchSize ?? 1000;
    const rows: Array<{
      id: string;
      user_id: string;
      trade_id: string;
      base_asset: string;
      counter_asset: string;
      side: string;
      amount: string;
      entry_price: string;
      exit_price: string | null;
      realized_pnl: string | null;
      closed_at: string;
      created_at: string;
    }> = await this.dataSource.query(
      `SELECT id, user_id, trade_id, base_asset, counter_asset, side, amount, 
              entry_price, exit_price, realized_pnl, closed_at, created_at
       FROM archived_positions
       WHERE closed_at >= $1 AND closed_at < $2
       ORDER BY closed_at ASC
       LIMIT $3`,
      [options.startDate, options.endDate, batchSize],
    );

    return rows.map((row) => ({
      id: row.id,
      timestamp: new Date(row.closed_at),
      source: this.sourceName,
      data: {
        originalPositionId: row.id,
        userId: row.user_id,
        tradeId: row.trade_id,
        baseAsset: row.base_asset,
        counterAsset: row.counter_asset,
        side: row.side,
        amount: parseFloat(row.amount),
        entryPrice: parseFloat(row.entry_price),
        exitPrice: row.exit_price ? parseFloat(row.exit_price) : null,
        realizedPnL: row.realized_pnl ? parseFloat(row.realized_pnl) : null,
        closedAt: row.closed_at,
        archivedAt: row.closed_at,
      },
    }));
  }
}