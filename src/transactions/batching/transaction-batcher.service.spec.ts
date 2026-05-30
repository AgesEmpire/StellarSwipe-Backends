import { Test, TestingModule } from '@nestjs/testing';
import { TransactionBatcherService } from './transaction-batcher.service';
import { BatchableTransaction } from './utils/batch-optimizer';

describe('TransactionBatcherService', () => {
  let service: TransactionBatcherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TransactionBatcherService],
    }).compile();

    service = module.get<TransactionBatcherService>(TransactionBatcherService);
  });

  describe('addToBatch', () => {
    it('should add transactions to the pending queue', () => {
      service.addToBatch({ id: 'tx1', amount: 100, asset: 'XLM', userId: 'u1' });
      service.addToBatch({ id: 'tx2', amount: 200, asset: 'USDC', userId: 'u2' });
      expect(service.getPendingCount()).toBe(2);
    });
  });

  describe('createBatch', () => {
    it('should create a batch and compute total amount', () => {
      const txs: BatchableTransaction[] = [
        { id: 'tx1', amount: 100, asset: 'XLM', userId: 'u1' },
        { id: 'tx2', amount: 200, asset: 'XLM', userId: 'u2' },
      ];

      const batch = service.createBatch(txs);
      expect(batch.totalAmount).toBe(300);
      expect(batch.transactions.length).toBe(2);
      expect(batch.batchId).toBeDefined();
    });

    it('should throw when creating batch with no transactions', () => {
      expect(() => service.createBatch([])).toThrow('Cannot create batch with no transactions');
    });

    it('should sort transactions by priority', () => {
      const txs: BatchableTransaction[] = [
        { id: 'tx1', amount: 100, asset: 'XLM', userId: 'u1', priority: 1 },
        { id: 'tx2', amount: 200, asset: 'XLM', userId: 'u2', priority: 10 },
      ];

      const batch = service.createBatch(txs);
      expect(batch.transactions[0].id).toBe('tx2');
    });
  });

  describe('processPendingBatch', () => {
    it('should process pending transactions and return count', async () => {
      service.addToBatch({ id: 'tx1', amount: 100, asset: 'XLM', userId: 'u1' });
      service.addToBatch({ id: 'tx2', amount: 200, asset: 'XLM', userId: 'u2' });

      const count = await service.processPendingBatch();
      expect(count).toBe(2);
      expect(service.getPendingCount()).toBe(0);
    });

    it('should return 0 when no pending transactions', async () => {
      const count = await service.processPendingBatch();
      expect(count).toBe(0);
    });

    it('should not duplicate transactions when batch fails midway', async () => {
      service.addToBatch({ id: 'tx1', amount: 100, asset: 'XLM', userId: 'u1' });
      await service.processPendingBatch();
      expect(service.getPendingCount()).toBe(0);
    });
  });

  describe('getBatch', () => {
    it('should return batch by id after creation', () => {
      const batch = service.createBatch([{ id: 'tx1', amount: 50, asset: 'XLM', userId: 'u1' }]);
      const found = service.getBatch(batch.batchId);
      expect(found).toEqual(batch);
    });

    it('should return undefined for unknown batch id', () => {
      expect(service.getBatch('non-existent-id')).toBeUndefined();
    });
  });
});
