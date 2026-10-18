import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { TradesService } from './trades.service';
import { TradeStatus, TradeSide } from './entities/trade.entity';

/**
 * Focused unit tests for TradesService.restoreTrade — restore authorization
 * and conflict rules (issue #1367). TradesService is instantiated directly
 * with hand-rolled mocks (rather than via Test.createTestingModule) so these
 * tests only need to stub what restoreTrade actually touches.
 */
describe('TradesService.restoreTrade', () => {
  function buildTrade(overrides: Partial<any> = {}) {
    return {
      id: 'trade-1',
      userId: 'user-1',
      signalId: 'signal-1',
      status: TradeStatus.COMPLETED,
      side: TradeSide.BUY,
      deletedAt: new Date(),
      ...overrides,
    };
  }

  function buildService(opts: {
    trade: any;
    otherTrades?: any[];
    activeRoles?: string[];
  }) {
    const trade = opts.trade;
    const otherTrades = opts.otherTrades ?? [];

    const tradeRepository: any = {
      findOne: jest.fn().mockResolvedValue(trade),
      restore: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([trade, ...otherTrades]),
      metadata: { name: 'Trade' },
    };

    const rbacService: any = {
      getUserRoles: jest.fn().mockResolvedValue(
        (opts.activeRoles ?? []).map((name) => ({
          isActive: () => true,
          role: { name },
        })),
      ),
    };

    const tradeAuditService: any = {
      logTradeRestored: jest.fn().mockResolvedValue(undefined),
    };

    const service = new TradesService(
      tradeRepository,
      {} as any, // dataSource
      {} as any, // riskManager
      {} as any, // tradeExecutor
      {} as any, // velocityRiskManager
      {} as any, // outboxService
      {} as any, // complianceRuleEngine
      {} as any, // tradeLatency
      {} as any, // slippageGuard
      {} as any, // atomicTx
      rbacService,
      tradeAuditService,
    );

    // getTradeById does a DB round trip through many collaborators; stub it
    // directly since restoreTrade's own authorization/conflict logic is what
    // these tests target.
    jest.spyOn(service as any, 'getTradeById').mockResolvedValue({ id: trade.id } as any);

    return { service, tradeRepository, rbacService, tradeAuditService };
  }

  it('throws NotFoundException when the trade does not exist', async () => {
    const { service, tradeRepository } = buildService({ trade: null as any });
    tradeRepository.findOne.mockResolvedValue(null);

    await expect(service.restoreTrade('missing', 'user-1')).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when the actor holds no restore-eligible role', async () => {
    const trade = buildTrade();
    const { service } = buildService({ trade, activeRoles: ['viewer'] });

    await expect(service.restoreTrade(trade.id, trade.userId)).rejects.toThrow(ForbiddenException);
  });

  it('restores when the actor holds the trader role', async () => {
    const trade = buildTrade();
    const { service, tradeRepository, tradeAuditService } = buildService({
      trade,
      activeRoles: ['trader'],
    });

    await service.restoreTrade(trade.id, trade.userId);

    expect(tradeRepository.restore).toHaveBeenCalledWith(trade.id);
    expect(tradeAuditService.logTradeRestored).toHaveBeenCalledWith(trade, ['trader']);
  });

  it('restores when the actor holds the admin role', async () => {
    const trade = buildTrade();
    const { service, tradeRepository } = buildService({ trade, activeRoles: ['admin'] });

    await service.restoreTrade(trade.id, trade.userId);

    expect(tradeRepository.restore).toHaveBeenCalledWith(trade.id);
  });

  it('throws ConflictException when an active replacement trade exists for the same signal', async () => {
    const trade = buildTrade();
    const replacement = buildTrade({
      id: 'trade-2',
      status: TradeStatus.SETTLED,
      deletedAt: null,
    });
    const { service, tradeRepository } = buildService({
      trade,
      otherTrades: [replacement],
      activeRoles: ['admin'],
    });

    await expect(service.restoreTrade(trade.id, trade.userId)).rejects.toThrow(ConflictException);
    expect(tradeRepository.restore).not.toHaveBeenCalled();
  });

  it('restores when the only other trade for the signal is cancelled', async () => {
    const trade = buildTrade();
    const cancelled = buildTrade({
      id: 'trade-3',
      status: TradeStatus.CANCELLED,
      deletedAt: null,
    });
    const { service, tradeRepository } = buildService({
      trade,
      otherTrades: [cancelled],
      activeRoles: ['admin'],
    });

    await service.restoreTrade(trade.id, trade.userId);

    expect(tradeRepository.restore).toHaveBeenCalledWith(trade.id);
  });
});
