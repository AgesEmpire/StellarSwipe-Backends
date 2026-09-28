import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationChannel } from '../notifications/entities/notification.entity';
import { NotificationService } from '../notifications/notification.service';
import { PriceService } from '../shared/price.service';
import { Trade, TradeSide, TradeStatus } from '../trades/entities/trade.entity';
import { TradeExecutorService } from '../trades/services/trade-executor.service';
import { RiskControlsService } from './risk-controls.service';

describe('RiskControlsService', () => {
  let service: RiskControlsService;
  let tradeRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let tradeExecutor: {
    closeTrade: jest.Mock;
  };
  let notificationService: {
    send: jest.Mock;
  };
  let priceService: {
    getCurrentPrice: jest.Mock;
  };
  let eventEmitter: {
    emit: jest.Mock;
  };

  const userId = 'user-1';

  beforeEach(async () => {
    tradeRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn((trade) => Promise.resolve(trade)),
    };

    tradeExecutor = {
      closeTrade: jest.fn().mockResolvedValue({ success: true }),
    };

    notificationService = {
      send: jest.fn().mockResolvedValue(undefined),
    };

    priceService = {
      getCurrentPrice: jest.fn(),
    };

    eventEmitter = {
      emit: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiskControlsService,
        { provide: getRepositoryToken(Trade), useValue: tradeRepository },
        { provide: TradeExecutorService, useValue: tradeExecutor },
        { provide: NotificationService, useValue: notificationService },
        { provide: PriceService, useValue: priceService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(RiskControlsService);
    jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);
    jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('setRiskLevels', () => {
    it('saves stop-loss and take-profit levels for an open completed trade', async () => {
      const trade = makeTrade();
      tradeRepository.findOne.mockResolvedValue(trade);

      await expect(
        service.setRiskLevels(userId, {
          tradeId: trade.id,
          stopLossPrice: '0.12000000',
          takeProfitPrice: '0.18000000',
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          stopLossPrice: '0.12000000',
          takeProfitPrice: '0.18000000',
        }),
      );

      expect(tradeRepository.findOne).toHaveBeenCalledWith({
        where: { id: trade.id, userId },
      });
      expect(tradeRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: trade.id,
          stopLossPrice: '0.12000000',
          takeProfitPrice: '0.18000000',
        }),
      );
    });

    it('rejects risk levels for a missing trade', async () => {
      tradeRepository.findOne.mockResolvedValue(null);

      await expect(
        service.setRiskLevels(userId, {
          tradeId: 'missing-trade',
          stopLossPrice: '0.12000000',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects risk levels for a closed trade', async () => {
      tradeRepository.findOne.mockResolvedValue(
        makeTrade({ closedAt: new Date('2026-01-01T00:00:00.000Z') }),
      );

      await expect(
        service.setRiskLevels(userId, {
          tradeId: 'trade-1',
          takeProfitPrice: '0.18000000',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('enforceRiskLevels', () => {
    it('closes the trade and notifies the user when stop-loss is reached', async () => {
      const trade = makeTrade({ stopLossPrice: '0.12000000' });
      tradeRepository.find.mockResolvedValue([trade]);
      priceService.getCurrentPrice.mockResolvedValue(0.1195);

      await service.enforceRiskLevels();

      expect(priceService.getCurrentPrice).toHaveBeenCalledWith('XLM/USDC');
      expect(tradeExecutor.closeTrade).toHaveBeenCalledWith(trade, '0.1195');
      expect(tradeRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: trade.id,
          exitPrice: '0.1195',
          metadata: expect.objectContaining({ closedBy: 'stop_loss' }),
        }),
      );
      expect(notificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          type: 'STOP_LOSS_TRIGGERED',
          title: 'Stop-Loss Executed',
          channel: NotificationChannel.IN_APP,
          metadata: expect.objectContaining({
            tradeId: trade.id,
            triggerPrice: '0.1195',
            type: 'stop_loss',
          }),
        }),
      );
    });

    it('closes the trade and notifies the user when take-profit is reached', async () => {
      const trade = makeTrade({ takeProfitPrice: '0.18000000' });
      tradeRepository.find.mockResolvedValue([trade]);
      priceService.getCurrentPrice.mockResolvedValue(0.18);

      await service.enforceRiskLevels();

      expect(priceService.getCurrentPrice).toHaveBeenCalledWith('XLM/USDC');
      expect(tradeExecutor.closeTrade).toHaveBeenCalledWith(trade, '0.18');
      expect(tradeRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: trade.id,
          exitPrice: '0.18',
          metadata: expect.objectContaining({ closedBy: 'take_profit' }),
        }),
      );
      expect(notificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          type: 'TAKE_PROFIT_TRIGGERED',
          title: 'Take-Profit Executed',
          metadata: expect.objectContaining({
            tradeId: trade.id,
            triggerPrice: '0.18',
            type: 'take_profit',
          }),
        }),
      );
    });

    it('does not close or notify when price remains between both risk levels', async () => {
      const trade = makeTrade({
        stopLossPrice: '0.12000000',
        takeProfitPrice: '0.18000000',
      });
      tradeRepository.find.mockResolvedValue([trade]);
      priceService.getCurrentPrice.mockResolvedValue(0.15);

      await service.enforceRiskLevels();

      expect(priceService.getCurrentPrice).toHaveBeenCalledWith('XLM/USDC');
      expect(tradeExecutor.closeTrade).not.toHaveBeenCalled();
      expect(tradeRepository.save).not.toHaveBeenCalled();
      expect(notificationService.send).not.toHaveBeenCalled();
    });

    it('does not fetch a price for trades without stop-loss or take-profit levels', async () => {
      tradeRepository.find.mockResolvedValue([makeTrade()]);

      await service.enforceRiskLevels();

      expect(priceService.getCurrentPrice).not.toHaveBeenCalled();
      expect(tradeExecutor.closeTrade).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('logs and skips enforcement when the price service throws', async () => {
      const trade = makeTrade({ stopLossPrice: '0.12000000' });
      tradeRepository.find.mockResolvedValue([trade]);
      priceService.getCurrentPrice.mockRejectedValue(new Error('feed offline'));

      await expect(service.enforceRiskLevels()).resolves.toBeUndefined();

      expect(priceService.getCurrentPrice).toHaveBeenCalledWith('XLM/USDC');
      expect(tradeExecutor.closeTrade).not.toHaveBeenCalled();
      expect(tradeRepository.save).not.toHaveBeenCalled();
      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Price feed failed for XLM/USDC'),
        expect.any(String),
      );
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('emits a monitoring alert after three consecutive price failures for the same pair', async () => {
      const trade = makeTrade({ stopLossPrice: '0.12000000' });
      tradeRepository.find.mockResolvedValue([trade]);
      priceService.getCurrentPrice.mockRejectedValue(
        new Error('provider timeout'),
      );

      await service.enforceRiskLevels();
      await service.enforceRiskLevels();
      await service.enforceRiskLevels();

      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'alert.price-feed.failure',
        expect.objectContaining({
          type: 'PRICE_FEED_UNAVAILABLE',
          severity: 'high',
          message: expect.stringContaining('XLM/USDC'),
          metrics: expect.objectContaining({
            assetPair: 'XLM/USDC',
            failureCount: 3,
            threshold: 3,
            error: 'provider timeout',
          }),
        }),
      );
      expect(tradeExecutor.closeTrade).not.toHaveBeenCalled();
    });

    it('resets failure tracking after a successful price fetch', async () => {
      const trade = makeTrade({ takeProfitPrice: '0.18000000' });
      tradeRepository.find.mockResolvedValue([trade]);
      priceService.getCurrentPrice
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValueOnce(0.15)
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockRejectedValueOnce(new Error('provider timeout'));

      await service.enforceRiskLevels();
      await service.enforceRiskLevels();
      await service.enforceRiskLevels();
      await service.enforceRiskLevels();
      await service.enforceRiskLevels();
      await service.enforceRiskLevels();
      await service.enforceRiskLevels();

      expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
      expect(tradeExecutor.closeTrade).not.toHaveBeenCalled();
    });

    it('tracks price failures independently by asset pair', async () => {
      const xlmTrade = makeTrade({
        id: 'trade-xlm',
        stopLossPrice: '0.12000000',
      });
      const ethTrade = makeTrade({
        id: 'trade-eth',
        baseAsset: 'ETH',
        counterAsset: 'USDC',
        stopLossPrice: '3400.00000000',
      });

      tradeRepository.find.mockResolvedValue([xlmTrade, ethTrade]);
      priceService.getCurrentPrice.mockRejectedValue(new Error('feed offline'));

      await service.enforceRiskLevels();
      await service.enforceRiskLevels();
      await service.enforceRiskLevels();

      expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'alert.price-feed.failure',
        expect.objectContaining({
          metrics: expect.objectContaining({ assetPair: 'XLM/USDC' }),
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'alert.price-feed.failure',
        expect.objectContaining({
          metrics: expect.objectContaining({ assetPair: 'ETH/USDC' }),
        }),
      );
    });
  });
});

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-1',
    userId: 'user-1',
    signalId: 'signal-1',
    status: TradeStatus.COMPLETED,
    side: TradeSide.BUY,
    baseAsset: 'XLM',
    counterAsset: 'USDC',
    entryPrice: '0.15000000',
    amount: '100.00000000',
    totalValue: '15.00000000',
    feeAmount: '0.00000000',
    transactionHash: 'tx-1',
    stopLossPrice: undefined,
    takeProfitPrice: undefined,
    closedAt: undefined,
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as Trade;
}
