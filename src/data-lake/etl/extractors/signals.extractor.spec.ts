import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SignalsExtractor } from './signals.extractor';

describe('SignalsExtractor', () => {
  let extractor: SignalsExtractor;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalsExtractor,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    extractor = module.get<SignalsExtractor>(SignalsExtractor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should have sourceName = signals', () => {
    expect(extractor.sourceName).toBe('signals');
  });

  describe('extract', () => {
    const startDate = new Date('2024-03-15T00:00:00Z');
    const endDate = new Date('2024-03-16T00:00:00Z');

    it('should return extracted signal records', async () => {
      dataSource.query.mockResolvedValue([
        {
          id: 'sig-1',
          provider_id: 'prov-1',
          asset_pair: 'XLM/USDC',
          action: 'BUY',
          confidence: '0.85',
          created_at: '2024-03-15T08:00:00Z',
          metadata: { strategy: 'momentum' },
        },
      ]);

      const records = await extractor.extract({ startDate, endDate });

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        id: 'sig-1',
        timestamp: new Date('2024-03-15T08:00:00Z'),
        source: 'signals',
        data: {
          providerId: 'prov-1',
          assetPair: 'XLM/USDC',
          action: 'BUY',
          confidence: 0.85,
          metadata: { strategy: 'momentum' },
        },
      });
    });

    it('should default metadata to empty object when null', async () => {
      dataSource.query.mockResolvedValue([
        {
          id: 'sig-2',
          provider_id: 'prov-2',
          asset_pair: 'ETH/USDC',
          action: 'SELL',
          confidence: '0.7',
          created_at: '2024-03-15T09:00:00Z',
          metadata: null,
        },
      ]);

      const records = await extractor.extract({ startDate, endDate });
      expect(records[0].data.metadata).toEqual({});
    });

    it('should parse confidence as float', async () => {
      dataSource.query.mockResolvedValue([
        {
          id: 'sig-3',
          provider_id: 'p',
          asset_pair: 'XLM/USDC',
          action: 'BUY',
          confidence: '0.95',
          created_at: '2024-03-15T10:00:00Z',
          metadata: {},
        },
      ]);

      const records = await extractor.extract({ startDate, endDate });
      expect(records[0].data.confidence).toBe(0.95);
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
      await extractor.extract({ startDate, endDate, batchSize: 5000 });

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.any(String),
        [startDate, endDate, 5000],
      );
    });
  });
});
