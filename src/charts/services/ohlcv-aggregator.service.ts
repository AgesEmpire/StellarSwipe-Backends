import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Timeframe, TIMEFRAME_SECONDS } from '../dto/ohlcv-query.dto';

export interface OhlcvCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

@Injectable()
export class OhlcvAggregatorService {
  private readonly logger = new Logger(OhlcvAggregatorService.name);

  constructor(private readonly dataSource: DataSource) {}

  async getOhlcv(
    assetPair: string,
    timeframe: Timeframe,
    limit: number,
  ): Promise<OhlcvCandle[]> {
    const intervalSecs = this.timeframeToSeconds(timeframe);
    // Fetch enough history to satisfy the requested number of candles
    const lookbackSecs = intervalSecs * limit * 2;

    const rows: Array<{
      timestamp_ms: string;
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
    }> = await this.dataSource.query(
      `
      SELECT
        (FLOOR(EXTRACT(EPOCH FROM ph.timestamp) / $3) * $3 * 1000)::bigint AS timestamp_ms,
        (ARRAY_AGG(ph.price::float8 ORDER BY ph.timestamp ASC))[1]  AS open,
        MAX(ph.price::float8)                                        AS high,
        MIN(ph.price::float8)                                        AS low,
        (ARRAY_AGG(ph.price::float8 ORDER BY ph.timestamp DESC))[1] AS close,
        COUNT(*)::bigint                                             AS volume
      FROM price_history ph
      WHERE ph.asset_pair = $1
        AND ph.timestamp >= NOW() - ($2::numeric * INTERVAL '1 second')
      GROUP BY FLOOR(EXTRACT(EPOCH FROM ph.timestamp) / $3)
      ORDER BY timestamp_ms ASC
      LIMIT $4
      `,
      [assetPair, lookbackSecs, intervalSecs, limit],
    );

    this.logger.debug(
      `OHLCV query returned ${rows.length} candles for ${assetPair} @ ${timeframe}`,
    );

    return rows.map((row) => ({
      timestamp: Number(row.timestamp_ms),
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      volume: Number(row.volume),
    }));
  }

  timeframeToSeconds(timeframe: Timeframe): number {
    return TIMEFRAME_SECONDS[timeframe];
  }
}
