import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TradeCsvExportService } from './trade-csv-export.service';
import { Trade, TradeSide, TradeStatus } from './entities/trade.entity';

const makeTrade = (overrides: Partial<Trade> = {}): Trade =>
  ({
    id: 'trade-1',
    userId: 'user-1',
    baseAsset: 'XLM',
    counterAsset: 'USDC',
    side: TradeSide.BUY,
    amount: '100.00',
    entryPrice: '0.25',
    feeAmount: '0.001',
    status: TradeStatus.SETTLED,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  } as Trade);

describe('TradeCsvExportService', () => {
  let service: TradeCsvExportService;
  let mockQueryBuilder: any;

  beforeEach(async () => {
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeCsvExportService,
        {
          provide: getRepositoryToken(Trade),
          useValue: { createQueryBuilder: jest.fn(() => mockQueryBuilder) },
        },
      ],
    }).compile();

    service = module.get(TradeCsvExportService);
  });

  describe('escapeCell', () => {
    it('returns plain value unchanged', () => {
      expect(service.escapeCell('XLM')).toBe('XLM');
    });

    it('wraps value with commas in double quotes', () => {
      expect(service.escapeCell('hello,world')).toBe('"hello,world"');
    });

    it('escapes embedded double quotes by doubling them', () => {
      expect(service.escapeCell('say "hi"')).toBe('"say ""hi"""');
    });

    it('returns empty string for null', () => {
      expect(service.escapeCell(null)).toBe('');
    });

    it('converts dates to ISO string', () => {
      const d = new Date('2024-01-01T00:00:00Z');
      expect(service.escapeCell(d)).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('buildCsvRow', () => {
    it('produces a comma-separated row with correct column order', () => {
      const trade = makeTrade();
      const row = service.buildCsvRow(trade);
      const cells = row.split(',');

      expect(cells[0]).toBe('2024-01-15T10:00:00.000Z');
      expect(cells[1]).toBe('XLM/USDC');
      expect(cells[2]).toBe(TradeSide.BUY);
      expect(cells[3]).toBe('100.00');
      expect(cells[4]).toBe('0.25');
      expect(cells[6]).toBe(TradeStatus.SETTLED);
    });
  });

  describe('streamUserTrades', () => {
    it('returns a PassThrough stream with CSV header as first chunk', (done) => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      const stream = service.streamUserTrades('user-1', {});
      const chunks: string[] = [];

      stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
      stream.on('end', () => {
        expect(chunks[0]).toBe('date,asset,side,quantity,price,fee,status\n');
        done();
      });
    });

    it('streams one CSV row per trade', (done) => {
      const trade = makeTrade();
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([trade])
        .mockResolvedValueOnce([]);

      const stream = service.streamUserTrades('user-1', {});
      let body = '';

      stream.on('data', (chunk: Buffer) => (body += chunk.toString()));
      stream.on('end', () => {
        const lines = body.trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain('XLM/USDC');
        done();
      });
    });

    it('applies startDate filter when provided', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      const stream = service.streamUserTrades('user-1', { startDate: '2024-01-01' });
      await new Promise((resolve) => stream.on('end', resolve));

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        't.created_at >= :startDate',
        expect.objectContaining({ startDate: expect.any(Date) }),
      );
    });

    it('applies endDate filter when provided', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      const stream = service.streamUserTrades('user-1', { endDate: '2024-12-31' });
      await new Promise((resolve) => stream.on('end', resolve));

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        't.created_at <= :endDate',
        expect.objectContaining({ endDate: expect.any(Date) }),
      );
    });
  });
});
