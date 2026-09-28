import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { PositionsExtractor } from './positions.extractor';

describe('PositionsExtractor', () => {
  let extractor: PositionsExtractor;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionsExtractor,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    extractor = module.get<PositionsExtractor>(PositionsExtractor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should have sourceName = positions', () => {
    expect(extractor.sourceName).toBe('positions');
  });

  describe('extract', () => {
    const startDate = new Date('2024-03-15T00:00:00Z');
    const endDate = new Date('2024-03-16T00:00:00Z');

    it('should return extracted archived position records', async () => {
      dataSource.query.mockResolvedValue([
        {
          id: 'archived-pos-1',
          user_id: 'user-1',
          trade_id: 'trade-1',
          base_asset: 'XLM',
          counter_asset: 'USDC',
          side: 'buy',
          amount: '100.5',
          entry_price: '0.12',
          exit_price: '0.15',
          realized_pnl: '5.00',
          closed_at: '2024-03-15T09:00:00Z',
          archived_at: '2024-06-01T00:00:00Z',
          created_at: '2024-03-15T09:00:00Z',
        },
      ]);

      const records = await extractor.extract({ startDate, endDate });

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        id: 'archived-pos-1',
        timestamp: new Date('2024-03-15T09:00:00Z'),
        source: 'positions',
        data: {
          originalPositionId: 'archived-pos-1',
          userId: 'user-1',
          tradeId: 'trade-1',
          baseAsset: 'XLM',
          counterAsset: 'USDC',
          side: 'buy',
          amount: 100.5,
          entryPrice: 0.12,
          exitPrice: 0.15,
          realizedPnL: 5.00,
          closedAt: '2024-03-15T09:00:00Z',
          archivedAt: '2024-03-15T09:00:00Z',
        },
      });
    });

    it('should handle nullable fields gracefully', async () => {
      dataSource.query.mockResolvedValue([
        {
          id: 'archived-pos-2',
          user_id: 'user-2',
          trade_id: null,
          base_asset: null,
          counter_asset: null,
          side: null,
          amount: null,
          entry_price: null,
          exit_price: null,
          realized_pnl: null,
          closed_at: '2024-03-15T12:00:00Z',
          archived_at: '2024-06-01T00:00:00Z',
          created_at: '2024-03-15T12:00:00Z',
        },
      ]);

      const records = await extractor.extract({ startDate, endDate });

      expect(records[0].data.amount).toBeNaN();
      expect(records[0].data.entryPrice).toBeNaN();
      expect(records[0].data.exitPrice).toBeNull();
      expect(records[0].data.realizedPnL).toBeNull();
    });

    it('should return empty array when no rows', async () => {
      dataSource.query.mockResolvedValue([]);
      const records = await extractor.extract({ startDate, endDate });
      expect(records).toEqual([]);
    });
  });
});