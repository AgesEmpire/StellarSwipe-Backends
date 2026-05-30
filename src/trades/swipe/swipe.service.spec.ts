import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SwipeService } from './swipe.service';
import { SwipeIntentDto, SwipeSource } from './dto/swipe-intent.dto';
import {
  TradeExecutionOrchestratorService,
  OrderType,
  OrchestratorResult,
} from '../services/trade-execution-orchestrator.service';
import { TradeSide, TradeStatus } from '../entities/trade.entity';

const successResult = (overrides: Partial<OrchestratorResult> = {}): OrchestratorResult => ({
  success: true,
  traceId: 'trace-001',
  orderType: OrderType.MARKET,
  stages: [{ stage: 'finalize', status: 'ok', durationMs: 12 }],
  result: {
    id: 'trade-abc',
    userId: 'user-001',
    signalId: 'signal-001',
    status: TradeStatus.COMPLETED,
    side: TradeSide.BUY,
    baseAsset: 'XLM',
    counterAsset: 'USDC',
    entryPrice: '0.15',
    amount: '100',
    totalValue: '15',
    feeAmount: '0.015',
    transactionHash: 'hash123',
    executedAt: new Date(),
    message: 'Trade executed successfully',
  },
  ...overrides,
});

const baseDto: SwipeIntentDto = {
  userId: 'user-001',
  signalId: 'signal-001',
  side: TradeSide.BUY,
  amount: 100,
  source: SwipeSource.GESTURE,
};

describe('SwipeService', () => {
  let service: SwipeService;
  const mockOrchestrator = { orchestrate: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwipeService,
        {
          provide: TradeExecutionOrchestratorService,
          useValue: mockOrchestrator,
        },
      ],
    }).compile();

    service = module.get(SwipeService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('gesture source', () => {
    it('delegates to orchestrator and returns result', async () => {
      mockOrchestrator.orchestrate.mockResolvedValue(successResult());

      const result = await service.handleSwipe(baseDto);

      expect(result.success).toBe(true);
      expect(mockOrchestrator.orchestrate).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-001', source: 'gesture' }),
      );
    });

    it('throws BadRequestException on orchestrator failure', async () => {
      mockOrchestrator.orchestrate.mockResolvedValue(
        successResult({ success: false, error: 'Soroban timeout' }),
      );

      await expect(service.handleSwipe(baseDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('keyboard source', () => {
    it('passes through keyboard source and shortcutKey to orchestrator', async () => {
      mockOrchestrator.orchestrate.mockResolvedValue(successResult());

      await service.handleSwipe({
        ...baseDto,
        source: SwipeSource.KEYBOARD,
        shortcutKey: 'shift+right',
      });

      expect(mockOrchestrator.orchestrate).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'keyboard' }),
      );
    });

    it('produces identical result shape as gesture', async () => {
      mockOrchestrator.orchestrate.mockResolvedValue(successResult());

      const gestureResult = await service.handleSwipe(baseDto);
      const keyboardResult = await service.handleSwipe({
        ...baseDto,
        source: SwipeSource.KEYBOARD,
        shortcutKey: 'shift+right',
      });

      // Same shape — only source differs internally
      expect(Object.keys(gestureResult)).toEqual(Object.keys(keyboardResult));
    });
  });

  describe('button source', () => {
    it('throws when confirmAction is missing', async () => {
      await expect(
        service.handleSwipe({ ...baseDto, source: SwipeSource.BUTTON }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when confirmAction is false', async () => {
      await expect(
        service.handleSwipe({
          ...baseDto,
          source: SwipeSource.BUTTON,
          confirmAction: false,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('proceeds when confirmAction is true', async () => {
      mockOrchestrator.orchestrate.mockResolvedValue(successResult());

      const result = await service.handleSwipe({
        ...baseDto,
        source: SwipeSource.BUTTON,
        confirmAction: true,
      });

      expect(result.success).toBe(true);
    });

    it('applies same validation and risk checks as gesture', async () => {
      mockOrchestrator.orchestrate.mockResolvedValue(
        successResult({ success: false, error: 'Insufficient balance' }),
      );

      await expect(
        service.handleSwipe({
          ...baseDto,
          source: SwipeSource.BUTTON,
          confirmAction: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('traceability', () => {
    it('includes traceId in error response when orchestration fails', async () => {
      mockOrchestrator.orchestrate.mockResolvedValue(
        successResult({ success: false, error: 'risk blocked', traceId: 'trace-xyz' }),
      );

      try {
        await service.handleSwipe(baseDto);
        fail('should have thrown');
      } catch (err: unknown) {
        const ex = err as BadRequestException;
        const body = ex.getResponse() as Record<string, unknown>;
        expect(body.traceId).toBe('trace-xyz');
      }
    });
  });

  describe('order type override', () => {
    it('forwards orderTypeOverride to the orchestrator', async () => {
      mockOrchestrator.orchestrate.mockResolvedValue(
        successResult({ orderType: OrderType.LIMIT }),
      );

      await service.handleSwipe({
        ...baseDto,
        orderTypeOverride: OrderType.LIMIT,
      });

      expect(mockOrchestrator.orchestrate).toHaveBeenCalledWith(
        expect.objectContaining({ orderTypeOverride: OrderType.LIMIT }),
      );
    });
  });
});
