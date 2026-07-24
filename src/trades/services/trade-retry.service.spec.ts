import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Trade, TradeStatus } from '../entities/trade.entity';
import { TradeExecutorService } from './trade-executor.service';
import { TradeRetryService } from './trade-retry.service';

describe('TradeRetryService — ownership', () => {
  let service: TradeRetryService;
  const tradeRepositoryMock = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const tradeExecutorMock = {
    executeTrade: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeRetryService,
        { provide: getRepositoryToken(Trade), useValue: tradeRepositoryMock },
        { provide: TradeExecutorService, useValue: tradeExecutorMock },
      ],
    }).compile();

    service = module.get(TradeRetryService);
  });

  it('rejects retry from a user who does not own the trade', async () => {
    tradeRepositoryMock.findOne.mockResolvedValue({
      id: 't1',
      userId: 'owner-1',
      status: TradeStatus.FAILED,
    });

    const result = await service.retryFailedTrade('t1', 'someone-else', false);

    expect(result.retryable).toBe(false);
    expect(result.message).toBe('You may only retry your own trades');
    expect(tradeRepositoryMock.save).not.toHaveBeenCalled();
    expect(tradeExecutorMock.executeTrade).not.toHaveBeenCalled();
  });

  it('allows an admin to retry a trade they do not own', async () => {
    tradeRepositoryMock.findOne.mockResolvedValue({
      id: 't1',
      userId: 'owner-1',
      status: TradeStatus.FAILED,
    });
    tradeRepositoryMock.save.mockImplementation((t) => t);
    tradeExecutorMock.executeTrade.mockResolvedValue({ success: true, transactionHash: '0xabc' });

    const result = await service.retryFailedTrade('t1', 'admin-1', true);

    expect(result.retryable).toBe(false);
    expect(result.message).toBe('Trade succeeded after retry');
  });

  it('allows the owning user to retry their own trade', async () => {
    tradeRepositoryMock.findOne.mockResolvedValue({
      id: 't1',
      userId: 'owner-1',
      status: TradeStatus.FAILED,
    });
    tradeRepositoryMock.save.mockImplementation((t) => t);
    tradeExecutorMock.executeTrade.mockResolvedValue({ success: true, transactionHash: '0xabc' });

    const result = await service.retryFailedTrade('t1', 'owner-1', false);

    expect(result.message).toBe('Trade succeeded after retry');
  });
});
