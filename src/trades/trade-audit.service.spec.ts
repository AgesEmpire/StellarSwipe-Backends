import { Test, TestingModule } from '@nestjs/testing';
import { TradeAuditService } from './trade-audit.service';
import { AuditService } from '../audit-log/audit.service';
import { AuditAction, AuditStatus } from '../audit-log/entities/audit-log.entity';
import { Trade, TradeStatus, TradeSide } from './entities/trade.entity';

const mockAuditService = { log: jest.fn().mockResolvedValue({ id: 'audit-uuid' }) };

const trade: Partial<Trade> = {
  id: 'trade-1',
  userId: 'user-1',
  signalId: 'signal-1',
  side: TradeSide.BUY,
  baseAsset: 'XLM',
  counterAsset: 'USDC',
  amount: '100',
  entryPrice: '0.15',
  totalValue: '15',
  feeAmount: '0.001',
  status: TradeStatus.COMPLETED,
  transactionHash: 'txhash123',
  sorobanContractId: 'CXXX',
};

describe('TradeAuditService', () => {
  let service: TradeAuditService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeAuditService,
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get(TradeAuditService);
  });

  it('logs TRADE_EXECUTED with SUCCESS status', async () => {
    await service.logTradeExecuted(trade as Trade);

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: AuditAction.TRADE_EXECUTED,
        resource: 'trade',
        resourceId: 'trade-1',
        status: AuditStatus.SUCCESS,
      }),
    );
  });

  it('logs trade failure with FAILURE status and reason', async () => {
    await service.logTradeFailed(trade as Trade, 'Insufficient balance');

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AuditStatus.FAILURE,
        errorMessage: 'Insufficient balance',
      }),
    );
  });

  it('logs TRADE_CANCELLED action', async () => {
    await service.logTradeCancelled(trade as Trade);

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.TRADE_CANCELLED }),
    );
  });

  it('logs risk gate decision with correct status', async () => {
    await service.logRiskGateDecision('user-1', 'trade-1', 'blocked', 'Velocity limit exceeded');

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'risk_gate',
        status: AuditStatus.FAILURE,
        metadata: expect.objectContaining({ decision: 'blocked', reason: 'Velocity limit exceeded' }),
      }),
    );
  });

  it('logs confirmation result with txHash in metadata', async () => {
    await service.logConfirmationResult(trade as Trade, 'txhash123', 'confirmed');

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'tx_confirmation',
        status: AuditStatus.SUCCESS,
        metadata: expect.objectContaining({ txHash: 'txhash123', outcome: 'confirmed' }),
      }),
    );
  });

  it('does NOT include sensitive wallet fields in payload', async () => {
    await service.logTradeExecuted(trade as Trade);

    const call = mockAuditService.log.mock.calls[0][0];
    const metadataKeys = Object.keys(call.metadata ?? {});
    const sensitiveKeys = ['privateKey', 'secretKey', 'mnemonic', 'seed', 'walletAddress'];
    sensitiveKeys.forEach((key) => {
      expect(metadataKeys).not.toContain(key);
    });
  });
});
