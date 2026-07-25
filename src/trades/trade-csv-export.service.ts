import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PassThrough } from 'stream';
import { Trade } from './entities/trade.entity';

export interface TradeExportQueryDto {
  startDate?: string;
  endDate?: string;
}

const CSV_COLUMNS = ['date', 'asset', 'side', 'quantity', 'price', 'fee', 'status'] as const;
const BATCH_SIZE = 100;

function escapeCsvCell(value: string | number | Date | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function tradeToRow(trade: Trade): string {
  const cells = [
    trade.createdAt.toISOString(),
    `${trade.baseAsset}/${trade.counterAsset}`,
    trade.side,
    trade.amount,
    trade.entryPrice,
    (trade as any).feeAmount ?? '',
    trade.status,
  ];
  return cells.map(escapeCsvCell).join(',');
}

@Injectable()
export class TradeCsvExportService {
  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
  ) {}

  streamUserTrades(userId: string, query: TradeExportQueryDto): PassThrough {
    const stream = new PassThrough();

    stream.push(CSV_COLUMNS.join(',') + '\n');

    setImmediate(async () => {
      try {
        let offset = 0;
        while (true) {
          const qb = this.tradeRepo
            .createQueryBuilder('t')
            .where('t.user_id = :userId', { userId })
            .orderBy('t.created_at', 'DESC')
            .skip(offset)
            .take(BATCH_SIZE);

          if (query.startDate) {
            qb.andWhere('t.created_at >= :startDate', { startDate: new Date(query.startDate) });
          }
          if (query.endDate) {
            qb.andWhere('t.created_at <= :endDate', { endDate: new Date(query.endDate) });
          }

          const batch = await qb.getMany();
          if (!batch.length) break;

          for (const trade of batch) {
            stream.push(tradeToRow(trade) + '\n');
          }

          if (batch.length < BATCH_SIZE) break;
          offset += BATCH_SIZE;
        }
        stream.end();
      } catch (err) {
        stream.destroy(err as Error);
      }
    });

    return stream;
  }

  buildCsvRow(trade: Trade): string {
    return tradeToRow(trade);
  }

  escapeCell(value: string | number | Date | null | undefined): string {
    return escapeCsvCell(value);
  }
}
