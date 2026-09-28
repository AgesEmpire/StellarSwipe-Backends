import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfirmationPollingService } from './services/confirmation-polling.service';
import { Trade, TradeStatus, TradeSide } from './entities/trade.entity';
import { StellarConfigService } from '../config/stellar.service';
import { NotificationService } from '../notifications/notification.service';

const TX_HASH = 'deadbeef1234';

const baseTrade: Partial<Trade> = {
  id: 'trade-uuid',
  userId: 'user-uuid',
  status: TradeStatus.EXECUTING,
  side: TradeSide.BUY,
  baseAsset: 'XLM',
  counterAsset: 'USDC',
  amount: '100',
  entryPrice: '0.15',
  totalValue: '15',
  feeAmount: '0',
};

const mockTradeRepo = {
  findOne: jest.fn().mockResolvedValue({ ...baseTrade }),
  save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
};

const mockNotificationService = { send: jest.fn().mockResolvedValue(undefined) };
const mockStellarConfig = { sorobanRpcUrl: 'https://soroban-testnet.stellar.org' };

let getTransactionMock: jest.Mock;

jest.mock('@stellar/stellar-sdk', () => ({
  SorobanRpc: {
    Server: jest.fn().mockImplementation(() => ({
      getTransaction: (...args: any[]) => getTransactionMock(...args),
    })),
  },
}));

describe('ConfirmationPollingService', () => {
  let service: ConfirmationPollingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfirmationPollingService,
        { provide: getRepositoryToken(Trade), useValue: mockTradeRepo },
        { provide: StellarConfigService, useValue: mockStellarConfig },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get(ConfirmationPollingService);
    // Speed up delays in tests
    jest.spyOn(service as any, 'delay').mockResolvedValue(undefined);
  });

  it('returns confirmed when transaction succeeds on first poll', async () => {
    getTransactionMock = jest.fn().mockResolvedValue({ status: 'SUCCESS' });

    const result = await service.pollUntilSettled('trade-uuid', TX_HASH);

    expect(result.status).toBe('confirmed');
    expect(mockTradeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: TradeStatus.CONFIRMED }),
    );
    expect(mockNotificationService.send).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Trade Confirmed' }),
    );
  });

  it('returns failed when transaction fails on-chain', async () => {
    getTransactionMock = jest
      .fn()
      .mockResolvedValueOnce({ status: 'PENDING' })
      .mockResolvedValueOnce({ status: 'FAILED', resultXdr: 'xdr-error' });

    const result = await service.pollUntilSettled('trade-uuid', TX_HASH);

    expect(result.status).toBe('failed');
    expect(mockTradeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: TradeStatus.FAILED }),
    );
    expect(mockNotificationService.send).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Trade Failed' }),
    );
  });

  it('returns timeout after exhausting all poll attempts', async () => {
    getTransactionMock = jest.fn().mockResolvedValue({ status: 'PENDING' });

    const result = await service.pollUntilSettled('trade-uuid', TX_HASH);

    expect(result.status).toBe('timeout');
    expect(result.failureReason).toMatch(/timed out/i);
    expect(mockTradeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: TradeStatus.FAILED }),
    );
    expect(mockNotificationService.send).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Trade Confirmation Timeout' }),
    );
  });

  it('returns failed immediately when trade is not found', async () => {
    mockTradeRepo.findOne.mockResolvedValueOnce(null);
    getTransactionMock = jest.fn();

    const result = await service.pollUntilSettled('missing-uuid', TX_HASH);

    expect(result.status).toBe('failed');
    expect(getTransactionMock).not.toHaveBeenCalled();
  });

  it('continues polling when RPC throws a transient error', async () => {
    getTransactionMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ status: 'SUCCESS' });

    const result = await service.pollUntilSettled('trade-uuid', TX_HASH);
    expect(result.status).toBe('confirmed');
  });
});
