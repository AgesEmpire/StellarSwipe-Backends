import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import {
  TradeExecutionOrchestratorService,
  OrderType,
  TradeIntent,
} from './trade-execution-orchestrator.service';
import { RiskManagerService } from './risk-manager.service';
import { TradeExecutorService } from './trade-executor.service';
import { RiskManagerService as VelocityRiskManager } from '../../risk/risk-manager.service';
import { ComplianceRuleEngineService } from '../../compliance/rule-engine/compliance-rule-engine.service';
import { SorobanTransactionBuilderService } from '../../soroban/soroban-transaction-builder.service';
import { TradeSagaService } from '../saga/trade-saga.service';
import { Trade, TradeStatus, TradeSide } from '../entities/trade.entity';

const mockTrade = (overrides: Partial<Trade> = {}): Trade =>
  ({
    id: 'trade-abc',
    userId: 'user-123',
    signalId: 'signal-456',
    side: TradeSide.BUY,
    baseAsset: 'XLM',
    counterAsset: 'USDC',
    entryPrice: '0.15000000',
    amount: '100',
    totalValue: '15.00000000',
    feeAmount: '0',
    status: TradeStatus.COMPLETED,
    transactionHash: 'abc123',
    executedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Trade);

describe('TradeExecutionOrchestratorService', () => {
  let service: TradeExecutionOrchestratorService;

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
  };

  const mockRiskManager = {
    checkDuplicateTrade: jest.fn().mockResolvedValue(false),
    validateTrade: jest.fn().mockResolvedValue({ isValid: true, errors: [], warnings: [] }),
  };

  const mockTradeExecutor = {
    executeTrade: jest.fn(),
  };

  const mockVelocityRisk = {
    validateTrade: jest.fn().mockResolvedValue(undefined),
    recordTradeExecution: jest.fn().mockResolvedValue(undefined),
  };

  const mockCompliance = {
    evaluateTrade: jest.fn().mockResolvedValue(undefined),
  };

  const mockTxBuilder = {
    buildMarketOrder: jest.fn().mockReturnValue({ validated: true }),
    buildLimitOrder: jest.fn().mockReturnValue({ validated: true }),
  };

  const mockSagaService = {
    executeTradeSaga: jest.fn(),
  };

  const baseIntent: TradeIntent = {
    userId: 'user-123',
    signalId: 'signal-456',
    side: TradeSide.BUY,
    amount: 100,
    walletAddress: 'GTEST',
    source: 'gesture',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeExecutionOrchestratorService,
        { provide: getRepositoryToken(Trade), useValue: mockRepo },
        { provide: RiskManagerService, useValue: mockRiskManager },
        { provide: TradeExecutorService, useValue: mockTradeExecutor },
        { provide: VelocityRiskManager, useValue: mockVelocityRisk },
        { provide: ComplianceRuleEngineService, useValue: mockCompliance },
        { provide: SorobanTransactionBuilderService, useValue: mockTxBuilder },
        { provide: TradeSagaService, useValue: mockSagaService },
      ],
    }).compile();

    service = module.get<TradeExecutionOrchestratorService>(
      TradeExecutionOrchestratorService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  describe('successful execution', () => {
    it('returns success result for a valid market order', async () => {
      const trade = mockTrade();
      mockSagaService.executeTradeSaga.mockResolvedValue({
        success: true,
        sagaId: 'saga-1',
        traceId: 'trace-1',
        tradeId: 'trade-abc',
        txHash: 'abc123',
        executedPrice: '0.15100000',
        feeAmount: '0.00015000',
      });
      mockRepo.findOneOrFail.mockResolvedValue(trade);

      const result = await service.orchestrate(baseIntent);

      expect(result.success).toBe(true);
      expect(result.traceId).toBeDefined();
      expect(result.orderType).toBe(OrderType.MARKET);
      expect(result.result?.transactionHash).toBe('abc123');
    });

    it('selects LIMIT order type when overridden', async () => {
      const trade = mockTrade();
      mockSagaService.executeTradeSaga.mockResolvedValue({
        success: true,
        sagaId: 'saga-2',
        traceId: 'trace-2',
        tradeId: 'trade-abc',
        txHash: 'lim001',
        feeAmount: '0.00015000',
      });
      mockRepo.findOneOrFail.mockResolvedValue(trade);

      const result = await service.orchestrate({
        ...baseIntent,
        orderTypeOverride: OrderType.LIMIT,
      });

      expect(result.success).toBe(true);
      expect(result.orderType).toBe(OrderType.LIMIT);
      expect(mockTxBuilder.buildLimitOrder).toHaveBeenCalled();
    });

    it('records all stages in the result', async () => {
      const trade = mockTrade();
      mockSagaService.executeTradeSaga.mockResolvedValue({
        success: true,
        sagaId: 'saga-3',
        traceId: 'trace-3',
        tradeId: 'trade-abc',
        txHash: 'stg001',
        feeAmount: '0',
      });
      mockRepo.findOneOrFail.mockResolvedValue(trade);

      const { stages } = await service.orchestrate(baseIntent);

      const stageNames = stages.map((s) => s.stage);
      expect(stageNames).toContain('account_validation');
      expect(stageNames).toContain('risk_checks');
      expect(stageNames).toContain('order_type_selection');
      expect(stageNames).toContain('saga_execution');
      stages.forEach((s) => expect(s.durationMs).toBeGreaterThanOrEqual(0));
    });

    it('passes saga execution to TradeSagaService with enriched context', async () => {
      const trade = mockTrade();
      mockSagaService.executeTradeSaga.mockResolvedValue({
        success: true,
        sagaId: 'saga-4',
        traceId: 'trace-4',
        tradeId: 'trade-abc',
        txHash: 'vel001',
        feeAmount: '0',
      });
      mockRepo.findOneOrFail.mockResolvedValue(trade);

      await service.orchestrate(baseIntent);

      expect(mockSagaService.executeTradeSaga).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          signalId: 'signal-456',
          baseAsset: 'XLM',
          counterAsset: 'USDC',
          entryPrice: expect.any(String),
        }),
      );
    });
  });

  describe('failure pathways', () => {
    it('returns failure when duplicate trade exists', async () => {
      mockRiskManager.checkDuplicateTrade.mockResolvedValueOnce(true);

      const result = await service.orchestrate(baseIntent);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/pending trade/i);
      expect(
        result.stages.find((s) => s.stage === 'account_validation')?.status,
      ).toBe('failed');
    });

    it('returns failure when trade validation errors exist', async () => {
      mockRiskManager.validateTrade.mockResolvedValueOnce({
        isValid: false,
        errors: ['Insufficient balance'],
        warnings: [],
      });

      const result = await service.orchestrate(baseIntent);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/validation failed/i);
    });

    it('returns failure when saga execution fails', async () => {
      mockSagaService.executeTradeSaga.mockResolvedValue({
        success: false,
        sagaId: 'saga-fail',
        traceId: 'trace-fail',
        error: 'Soroban RPC timeout',
      });

      const result = await service.orchestrate(baseIntent);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Soroban RPC timeout/i);
    });

    it('returns failure when compliance check throws', async () => {
      mockCompliance.evaluateTrade.mockRejectedValueOnce(
        new BadRequestException('KYC not verified'),
      );

      const result = await service.orchestrate(baseIntent);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/KYC/i);
    });

    it('records failed stage detail in stages array', async () => {
      mockRiskManager.checkDuplicateTrade.mockResolvedValueOnce(true);

      const { stages } = await service.orchestrate(baseIntent);

      const failedStage = stages.find((s) => s.status === 'failed');
      expect(failedStage).toBeDefined();
      expect(failedStage!.detail).toBeDefined();
    });

    it('returns a traceId even on failure for traceability', async () => {
      mockRiskManager.checkDuplicateTrade.mockResolvedValueOnce(true);

      const result = await service.orchestrate(baseIntent);

      expect(result.traceId).toBeDefined();
      expect(result.traceId).toHaveLength(36); // UUID
    });
  });

  describe('source variants', () => {
    it.each(['gesture', 'keyboard', 'button'] as const)(
      'accepts "%s" as a valid source',
      async (source) => {
        const trade = mockTrade();
        mockSagaService.executeTradeSaga.mockResolvedValue({
          success: true,
          sagaId: 'saga-src',
          traceId: 'trace-src',
          tradeId: 'trade-abc',
          txHash: `${source}-tx`,
          feeAmount: '0',
        });
        mockRepo.findOneOrFail.mockResolvedValue(trade);

        const result = await service.orchestrate({ ...baseIntent, source });

        expect(result.success).toBe(true);
      },
    );
  });
});

const mockTrade = (overrides: Partial<Trade> = {}): Trade =>
  ({
    id: 'trade-abc',
    userId: 'user-123',
    signalId: 'signal-456',
    side: TradeSide.BUY,
    baseAsset: 'XLM',
    counterAsset: 'USDC',
    entryPrice: '0.15000000',
    amount: '100',
    totalValue: '15.00000000',
    feeAmount: '0',
    status: TradeStatus.EXECUTING,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Trade);

describe('TradeExecutionOrchestratorService', () => {
  let service: TradeExecutionOrchestratorService;

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  const mockRiskManager = {
    checkDuplicateTrade: jest.fn().mockResolvedValue(false),
    validateTrade: jest.fn().mockResolvedValue({ isValid: true, errors: [], warnings: [] }),
  };

  const mockTradeExecutor = {
    executeTrade: jest.fn(),
  };

  const mockVelocityRisk = {
    validateTrade: jest.fn().mockResolvedValue(undefined),
    recordTradeExecution: jest.fn().mockResolvedValue(undefined),
  };

  const mockCompliance = {
    evaluateTrade: jest.fn().mockResolvedValue(undefined),
  };

  const mockTxBuilder = {
    buildMarketOrder: jest.fn().mockReturnValue({ validated: true }),
    buildLimitOrder: jest.fn().mockReturnValue({ validated: true }),
  };

  const baseIntent: TradeIntent = {
    userId: 'user-123',
    signalId: 'signal-456',
    side: TradeSide.BUY,
    amount: 100,
    walletAddress: 'GTEST',
    source: 'gesture',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeExecutionOrchestratorService,
        { provide: getRepositoryToken(Trade), useValue: mockRepo },
        { provide: RiskManagerService, useValue: mockRiskManager },
        { provide: TradeExecutorService, useValue: mockTradeExecutor },
        { provide: VelocityRiskManager, useValue: mockVelocityRisk },
        { provide: ComplianceRuleEngineService, useValue: mockCompliance },
        { provide: SorobanTransactionBuilderService, useValue: mockTxBuilder },
      ],
    }).compile();

    service = module.get<TradeExecutionOrchestratorService>(
      TradeExecutionOrchestratorService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  describe('successful execution', () => {
    it('returns success result for a valid market order', async () => {
      const trade = mockTrade();
      mockRepo.create.mockReturnValue(trade);
      mockRepo.save.mockResolvedValue(trade);
      mockTradeExecutor.executeTrade.mockResolvedValue({
        success: true,
        transactionHash: 'abc123',
        executedPrice: '0.15100000',
        feeAmount: '0.00015000',
        contractId: 'CONTRACT_XYZ',
      });

      const result = await service.orchestrate(baseIntent);

      expect(result.success).toBe(true);
      expect(result.traceId).toBeDefined();
      expect(result.orderType).toBe(OrderType.MARKET);
      expect(result.result?.transactionHash).toBe('abc123');
    });

    it('selects LIMIT order type when overridden', async () => {
      const trade = mockTrade();
      mockRepo.create.mockReturnValue(trade);
      mockRepo.save.mockResolvedValue(trade);
      mockTradeExecutor.executeTrade.mockResolvedValue({
        success: true,
        transactionHash: 'lim001',
        feeAmount: '0.00015000',
      });

      const result = await service.orchestrate({
        ...baseIntent,
        orderTypeOverride: OrderType.LIMIT,
      });

      expect(result.success).toBe(true);
      expect(result.orderType).toBe(OrderType.LIMIT);
      expect(mockTxBuilder.buildLimitOrder).toHaveBeenCalled();
    });

    it('records all stages in the result', async () => {
      const trade = mockTrade();
      mockRepo.create.mockReturnValue(trade);
      mockRepo.save.mockResolvedValue(trade);
      mockTradeExecutor.executeTrade.mockResolvedValue({
        success: true,
        transactionHash: 'stg001',
        feeAmount: '0',
      });

      const { stages } = await service.orchestrate(baseIntent);

      const stageNames = stages.map((s) => s.stage);
      expect(stageNames).toContain('account_validation');
      expect(stageNames).toContain('risk_checks');
      expect(stageNames).toContain('order_type_selection');
      expect(stageNames).toContain('soroban_execution');
      expect(stageNames).toContain('finalize');
      stages.forEach((s) => expect(s.durationMs).toBeGreaterThanOrEqual(0));
    });

    it('calls velocity risk manager after successful execution', async () => {
      const trade = mockTrade();
      mockRepo.create.mockReturnValue(trade);
      mockRepo.save.mockResolvedValue(trade);
      mockTradeExecutor.executeTrade.mockResolvedValue({
        success: true,
        transactionHash: 'vel001',
        feeAmount: '0',
      });

      await service.orchestrate(baseIntent);

      expect(mockVelocityRisk.recordTradeExecution).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-123' }),
      );
    });
  });

  describe('failure pathways', () => {
    it('returns failure when duplicate trade exists', async () => {
      mockRiskManager.checkDuplicateTrade.mockResolvedValueOnce(true);

      const result = await service.orchestrate(baseIntent);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/pending trade/i);
      expect(
        result.stages.find((s) => s.stage === 'account_validation')?.status,
      ).toBe('failed');
    });

    it('returns failure when trade validation errors exist', async () => {
      mockRiskManager.validateTrade.mockResolvedValueOnce({
        isValid: false,
        errors: ['Insufficient balance'],
        warnings: [],
      });

      const result = await service.orchestrate(baseIntent);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/validation failed/i);
    });

    it('returns failure when Soroban execution fails', async () => {
      const trade = mockTrade();
      mockRepo.create.mockReturnValue(trade);
      mockRepo.save.mockResolvedValue(trade);
      mockTradeExecutor.executeTrade.mockResolvedValue({
        success: false,
        error: 'Soroban RPC timeout',
      });

      const result = await service.orchestrate(baseIntent);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/execution failed/i);
      // Verify the trade was marked failed
      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: TradeStatus.FAILED }),
      );
    });

    it('returns failure when compliance check throws', async () => {
      mockCompliance.evaluateTrade.mockRejectedValueOnce(
        new BadRequestException('KYC not verified'),
      );

      const result = await service.orchestrate(baseIntent);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/KYC/i);
    });

    it('records failed stage detail in stages array', async () => {
      mockRiskManager.checkDuplicateTrade.mockResolvedValueOnce(true);

      const { stages } = await service.orchestrate(baseIntent);

      const failedStage = stages.find((s) => s.status === 'failed');
      expect(failedStage).toBeDefined();
      expect(failedStage!.detail).toBeDefined();
    });

    it('returns a traceId even on failure for traceability', async () => {
      mockRiskManager.checkDuplicateTrade.mockResolvedValueOnce(true);

      const result = await service.orchestrate(baseIntent);

      expect(result.traceId).toBeDefined();
      expect(result.traceId).toHaveLength(36); // UUID
    });
  });

  describe('source variants', () => {
    it.each(['gesture', 'keyboard', 'button'] as const)(
      'accepts "%s" as a valid source',
      async (source) => {
        const trade = mockTrade();
        mockRepo.create.mockReturnValue(trade);
        mockRepo.save.mockResolvedValue(trade);
        mockTradeExecutor.executeTrade.mockResolvedValue({
          success: true,
          transactionHash: `${source}-tx`,
          feeAmount: '0',
        });

        const result = await service.orchestrate({ ...baseIntent, source });

        expect(result.success).toBe(true);
      },
    );
  });
});
