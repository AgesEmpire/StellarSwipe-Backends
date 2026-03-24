import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { UserEventsExtractor } from './user-events.extractor';

describe('UserEventsExtractor', () => {
  let extractor: UserEventsExtractor;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserEventsExtractor,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    extractor = module.get<UserEventsExtractor>(UserEventsExtractor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should have sourceName = user_events', () => {
    expect(extractor.sourceName).toBe('user_events');
  });

  describe('extract', () => {
    const startDate = new Date('2024-03-15T00:00:00Z');
    const endDate = new Date('2024-03-16T00:00:00Z');

    it('should return extracted records from database rows', async () => {
      dataSource.query.mockResolvedValue([
        {
          id: 'evt-1',
          user_id: 'user-1',
          event_type: 'SWIPE_RIGHT',
          occurred_at: '2024-03-15T10:00:00Z',
          metadata: { source: 'mobile' },
        },
        {
          id: 'evt-2',
          user_id: 'user-2',
          event_type: 'TRADE_EXECUTED',
          occurred_at: '2024-03-15T11:00:00Z',
          metadata: null,
        },
      ]);

      const records = await extractor.extract({ startDate, endDate });

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({
        id: 'evt-1',
        timestamp: new Date('2024-03-15T10:00:00Z'),
        source: 'user_events',
        data: {
          userId: 'user-1',
          eventType: 'SWIPE_RIGHT',
          metadata: { source: 'mobile' },
        },
      });
      expect(records[1].data.metadata).toEqual({});
    });

    it('should return empty array when no rows found', async () => {
      dataSource.query.mockResolvedValue([]);
      const records = await extractor.extract({ startDate, endDate });
      expect(records).toEqual([]);
    });

    it('should use default batchSize of 1000 when not specified', async () => {
      dataSource.query.mockResolvedValue([]);
      await extractor.extract({ startDate, endDate });

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.any(String),
        [startDate, endDate, 1000],
      );
    });

    it('should use provided batchSize', async () => {
      dataSource.query.mockResolvedValue([]);
      await extractor.extract({ startDate, endDate, batchSize: 500 });

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.any(String),
        [startDate, endDate, 500],
      );
    });

    it('should set source to user_events on each record', async () => {
      dataSource.query.mockResolvedValue([
        {
          id: 'evt-1',
          user_id: 'u1',
          event_type: 'LOGIN',
          occurred_at: '2024-03-15T00:00:00Z',
          metadata: {},
        },
      ]);

      const records = await extractor.extract({ startDate, endDate });
      expect(records[0].source).toBe('user_events');
    });
  });
});
