import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OnChainSyncService } from '../on-chain-sync.service';
import { OnChainEvent, OnChainEventType } from '../entities/on-chain-event.entity';
import { StellarConfigService } from '../../config/stellar.service';

const mockInsertBuilder = {
  insert: jest.fn().mockReturnThis(),
  into: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  orIgnore: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 'uuid-1' }] }),
};

const mockWatermarkBuilder = {
  select: jest.fn().mockReturnThis(),
  getRawOne: jest.fn().mockResolvedValue({ max: 0 }),
};

const mockRepo = {
  createQueryBuilder: jest.fn((alias?: string) =>
    alias === 'e' ? mockWatermarkBuilder : mockInsertBuilder,
  ),
};

const mockStellarConfig = { horizonUrl: 'https://horizon-testnet.stellar.org' };

// Minimal Horizon server mock
const mockTxPage = {
  records: [
    {
      hash: 'abc123',
      ledger: 100,
      created_at: '2024-01-01T00:00:00Z',
      successful: true,
      operations: jest.fn().mockResolvedValue({
        records: [
          { type: 'manage_sell_offer', id: 'op1' },
          { type: 'invoke_host_function', id: 'op2', contract_id: 'CXXX' },
        ],
      }),
    },
    {
      hash: 'def456',
      ledger: 101,
      created_at: '2024-01-01T00:00:05Z',
      successful: false, // should be skipped
    },
  ],
};

jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      transactions: jest.fn().mockReturnValue({
        cursor: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue(mockTxPage),
      }),
    })),
  },
}));

describe('OnChainSyncService', () => {
  let service: OnChainSyncService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnChainSyncService,
        { provide: getRepositoryToken(OnChainEvent), useValue: mockRepo },
        { provide: StellarConfigService, useValue: mockStellarConfig },
      ],
    }).compile();

    service = module.get(OnChainSyncService);
  });

  it('ingests successful transactions and skips failed ones', async () => {
    const count = await service.syncLatestEvents();
    // 2 ops from the successful tx; failed tx skipped
    expect(count).toBe(2);
    expect(mockInsertBuilder.execute).toHaveBeenCalledTimes(2);
  });

  it('classifies manage_sell_offer as TRADE_EXECUTED', async () => {
    await service.syncLatestEvents();
    const firstCall = mockInsertBuilder.values.mock.calls[0][0];
    expect(firstCall.eventType).toBe(OnChainEventType.TRADE_EXECUTED);
  });

  it('classifies invoke_host_function as CONTRACT_RESULT', async () => {
    await service.syncLatestEvents();
    const secondCall = mockInsertBuilder.values.mock.calls[1][0];
    expect(secondCall.eventType).toBe(OnChainEventType.CONTRACT_RESULT);
    expect(secondCall.contractId).toBe('CXXX');
  });

  it('is idempotent — duplicate events are silently skipped via orIgnore', async () => {
    mockInsertBuilder.execute
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('unique constraint violation'));

    // Should not throw even when second insert fails
    await expect(service.syncLatestEvents()).resolves.not.toThrow();
  });

  it('advances the watermark ledger after sync', async () => {
    await service.syncLatestEvents();
    // Call again — watermark should be 100 (last successful ledger)
    // The second call should NOT re-query the DB watermark (already cached)
    mockWatermarkBuilder.getRawOne.mockClear();
    await service.syncLatestEvents();
    expect(mockWatermarkBuilder.getRawOne).not.toHaveBeenCalled();
  });
});
