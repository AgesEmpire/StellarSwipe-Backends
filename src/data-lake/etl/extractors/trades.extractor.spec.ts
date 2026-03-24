import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TradesExtractor } from './trades.extractor';

describe('TradesExtractor', () => {
  let extractor: TradesExtractor;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradesExtractor,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    extractor = module.get<TradesExtractor>(TradesExtractor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should have sourceName = trades', () => {
    expect(extractor.sourceName).toBe('trades');
  });

  describe('extract', () => {
    const startDate = new Date('2024-03-15T00:00:00Z');
    const endDate = new Date('2024-03-16T00:00:00Z');

    it('should return extracted trade records', async () => {
      dataSource.query.mockResolvedValue([
        {
          id: 'trade-1',
          user_id: 'user-1',
          asset_pair: 'XLM/USDC',
          amount: '100.5',
          price: '0.12',
          status: 'completed',
          created_at: '2024-03-15T09:00:00Z',
        },
      ]);

      const records = await extractor.extract({ startDate, endDate });

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        id: 'trade-1',
        timestamp: new Date('2024-03-15T09:00:00Z'),
        source: 'trades',
        data: {
          userId: 'user-1',
          assetPair: 'XLM/USDC',
          amount: 100.5,
          price: 0.12,
          status: 'completed',
        },
      });
    });

    it('should parse amount and price as floats', async () => {
      dataSource.query.mockResolvedValue([
        {
          id: 'trade-2',
          user_id: 'u2',
          asset_pair: 'BTC/USDC',
          amount: '0.001',
          price: '45000.99',
          status: 'pending',
          created_at: '2024-03-15T12:00:00Z',
        },
      ]);

      const records = await extractor.extract({ startDate, endDate });
      expect(records[0].data.amount).toBe(0.001);
      expect(records[0].data.price).toBe(45000.99);
    });

    it('should return empty array when no rows', async () => {
      dataSource.query.mockResolvedValue([]);
      const records = await extractor.extract({ startDate, endDate });
      expect(records).toEqual([]);
    });

    it('should use default batchSize of 1000', async () => {
      dataSource.query.mockResolvedValue([]);
      await extractor.extract({ startDate, endDate });

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.any(String),
        [startDate, endDate, 1000],
      );
    });

    it('should use custom batchSize', async () => {
      dataSource.query.mockResolvedValue([]);
      await extractor.extract({ startDate, endDate, batchSize: 2000 });

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.any(String),
        [startDate, endDate, 2000],
      );
    });
  });
});
