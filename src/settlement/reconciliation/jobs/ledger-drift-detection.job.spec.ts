import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LedgerDriftDetectionJob, LedgerDriftEvent } from './ledger-drift-detection.job';
import { Trade, TradeStatus } from '../../../trades/entities/trade.entity';
import { HorizonBulkheadService } from '../../../stellar/bulkhead/horizon-bulkhead.service';

describe('LedgerDriftDetectionJob', () => {
  let job: LedgerDriftDetectionJob;
  let tradeRepo: jest.Mocked<Repository<Trade>>;
  let horizonBulkhead: jest.Mocked<HorizonBulkheadService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerDriftDetectionJob,
        {
          provide: 'TRADE_REPOSITORY',
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: HorizonBulkheadService,
          useValue: {
            read: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    job = module.get<LedgerDriftDetectionJob>(LedgerDriftDetectionJob);
    tradeRepo = module.get('TRADE_REPOSITORY');
    horizonBulkhead = module.get(HorizonBulkheadService);
    eventEmitter = module.get(EventEmitter2);
  });

  describe('detectLedgerDrift', () => {
    it('should complete successfully with no trades', async () => {
      tradeRepo.find.mockResolvedValue([]);

      await job.detectLedgerDrift();

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'settlement.reconciliation.completed',
        expect.objectContaining({
          sampledTrades: 0,
          driftCount: 0,
        }),
      );
    });

    it('should detect drift when local status differs from on-chain status', async () => {
      const trade = {
        id: 'trade-1',
        status: TradeStatus.SETTLED,
        transactionHash: 'abc123def456',
        ledger: 12345,
        executedAt: new Date(),
      } as Trade;

      tradeRepo.find.mockResolvedValue([trade]);
      horizonBulkhead.read.mockResolvedValue('failed'); // Mismatch: local is SETTLED, on-chain is failed

      await job.detectLedgerDrift();

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'settlement.drift.detected',
        expect.objectContaining({
          tradeId: 'trade-1',
          transactionHash: 'abc123def456',
          localStatus: TradeStatus.SETTLED,
          onChainStatus: 'failed',
        }),
      );
    });

    it('should not emit drift event when status matches', async () => {
      const trade = {
        id: 'trade-1',
        status: TradeStatus.SETTLED,
        transactionHash: 'abc123def456',
        ledger: 12345,
        executedAt: new Date(),
      } as Trade;

      tradeRepo.find.mockResolvedValue([trade]);
      horizonBulkhead.read.mockResolvedValue('success'); // Match: local is SETTLED (= success), on-chain is success

      await job.detectLedgerDrift();

      expect(eventEmitter.emit).not.toHaveBeenCalledWith('settlement.drift.detected', expect.anything());
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'settlement.reconciliation.completed',
        expect.objectContaining({
          driftCount: 0,
        }),
      );
    });

    it('should handle multiple trades and report drift count', async () => {
      const trades = [
        {
          id: 'trade-1',
          status: TradeStatus.SETTLED,
          transactionHash: 'hash1',
          ledger: 1,
          executedAt: new Date(),
        } as Trade,
        {
          id: 'trade-2',
          status: TradeStatus.SETTLED,
          transactionHash: 'hash2',
          ledger: 2,
          executedAt: new Date(),
        } as Trade,
        {
          id: 'trade-3',
          status: TradeStatus.SETTLED,
          transactionHash: 'hash3',
          ledger: 3,
          executedAt: new Date(),
        } as Trade,
      ];

      tradeRepo.find.mockResolvedValue(trades);
      horizonBulkhead.read
        .mockResolvedValueOnce('success') // trade-1: no drift
        .mockResolvedValueOnce('failed') // trade-2: drift
        .mockResolvedValueOnce('success'); // trade-3: no drift

      await job.detectLedgerDrift();

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'settlement.reconciliation.completed',
        expect.objectContaining({
          sampledTrades: 3,
          driftCount: 1,
        }),
      );
    });

    it('should handle trades with missing transactionHash', async () => {
      const trade = {
        id: 'trade-1',
        status: TradeStatus.SETTLED,
        transactionHash: undefined,
        ledger: 12345,
        executedAt: new Date(),
      } as Trade;

      tradeRepo.find.mockResolvedValue([trade]);

      await job.detectLedgerDrift();

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'settlement.drift.detected',
        expect.objectContaining({
          tradeId: 'trade-1',
          transactionHash: 'N/A',
          onChainStatus: 'UNKNOWN',
        }),
      );
    });

    it('should handle Horizon fetch failures gracefully', async () => {
      const trade = {
        id: 'trade-1',
        status: TradeStatus.SETTLED,
        transactionHash: 'abc123def456',
        ledger: 12345,
        executedAt: new Date(),
      } as Trade;

      tradeRepo.find.mockResolvedValue([trade]);
      horizonBulkhead.read.mockRejectedValue(new Error('Horizon connection failed'));

      await job.detectLedgerDrift();

      // Should not emit drift event for fetch failures
      expect(eventEmitter.emit).not.toHaveBeenCalledWith('settlement.drift.detected', expect.anything());
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'settlement.reconciliation.completed',
        expect.objectContaining({
          driftCount: 0,
        }),
      );
    });

    it('should emit failure event when job encounters critical error', async () => {
      tradeRepo.find.mockRejectedValue(new Error('Database connection failed'));

      await job.detectLedgerDrift();

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'settlement.reconciliation.failed',
        expect.objectContaining({
          error: 'Database connection failed',
        }),
      );
    });

    it('should handle COMPLETED status as equivalent to SETTLED', async () => {
      const trade = {
        id: 'trade-1',
        status: TradeStatus.COMPLETED,
        transactionHash: 'abc123def456',
        ledger: 12345,
        executedAt: new Date(),
      } as Trade;

      tradeRepo.find.mockResolvedValue([trade]);
      horizonBulkhead.read.mockResolvedValue('success');

      await job.detectLedgerDrift();

      // Should not emit drift since COMPLETED normalizes to success
      expect(eventEmitter.emit).not.toHaveBeenCalledWith('settlement.drift.detected', expect.anything());
    });

    it('should handle CONFIRMED status as equivalent to SETTLED', async () => {
      const trade = {
        id: 'trade-1',
        status: TradeStatus.CONFIRMED,
        transactionHash: 'abc123def456',
        ledger: 12345,
        executedAt: new Date(),
      } as Trade;

      tradeRepo.find.mockResolvedValue([trade]);
      horizonBulkhead.read.mockResolvedValue('success');

      await job.detectLedgerDrift();

      // Should not emit drift since CONFIRMED normalizes to success
      expect(eventEmitter.emit).not.toHaveBeenCalledWith('settlement.drift.detected', expect.anything());
    });
  });
});
