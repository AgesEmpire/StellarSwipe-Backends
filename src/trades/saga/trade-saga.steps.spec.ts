import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { TradeSagaStepsFactory, TradeSagaContext } from './trade-saga.steps';
import { Trade, TradeStatus, TradeSide } from '../entities/trade.entity';
import { TradeExecutorService } from '../services/trade-executor.service';
import { SorobanTransactionBuilderService } from '../../soroban/soroban-transaction-builder.service';
import { RiskManagerService as VelocityRiskManager } from '../../risk/risk-manager.service';

// ── Helpers ────────────────────────────────────────────────────────────────────

const mockTrade = (id = 'trade-1'): Trade =>
  ({
    id,
    userId: 'user-1',
    signalId: 'sig-1',
    side: TradeSide.BUY,
    baseAsset: 'XLM',
    counterAsset: 'USDC',
    entryPrice: '0.15',
    amount: '100',
    totalValue: '15.00',
    status: TradeStatus.EXECUTING,
  }) as Trade;

const baseCtx = (): TradeSagaContext => ({
  userId: 'user-1',
  signalId: 'sig-1',
  side: 'buy',
  amount: 100,
  baseAsset: 'XLM',
  counterAsset: 'USDC',
  entryPrice: '0.15',
  orderType: 'market',
  traceId: 'trace-1',
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TradeSagaStepsFactory', () => {
  let factory: TradeSagaStepsFactory;
  let tradeRepo: jest.Mocked<Partial<Repository<Trade>>>;
  let tradeExecutor: jest.Mocked<Partial<TradeExecutorService>>;
  let velocityRisk: jest.Mocked<Partial<VelocityRiskManager>>;

  beforeEach(async () => {
    tradeRepo = {
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      findOneOrFail: jest.fn(),
    };

    tradeExecutor = {
      executeTrade: jest.fn(),
    };

    velocityRisk = {
      recordTradeExecution: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeSagaStepsFactory,
        { provide: getRepositoryToken(Trade), useValue: tradeRepo },
        { provide: TradeExecutorService, useValue: tradeExecutor },
        { provide: SorobanTransactionBuilderService, useValue: {} },
        { provide: VelocityRiskManager, useValue: velocityRisk },
      ],
    }).compile();

    factory = module.get(TradeSagaStepsFactory);
  });

  describe('build()', () => {
    it('returns exactly 5 named steps in the correct order', () => {
      const steps = factory.build();
      expect(steps.map((s) => s.name)).toEqual([
        'reserve_funds',
        'persist_trade',
        'soroban_execution',
        'update_portfolio',
        'finalize_trade',
      ]);
    });
  });

  // ── Step 1: reserve_funds ──────────────────────────────────────────────────

  describe('reserve_funds step', () => {
    it('execute sets fundsReserved=true', async () => {
      const step = factory.build()[0];
      const patch = await step.execute(baseCtx());
      expect(patch.fundsReserved).toBe(true);
    });

    it('compensate is a no-op when fundsReserved is false', async () => {
      const step = factory.build()[0];
      await expect(
        step.compensate({ ...baseCtx(), fundsReserved: false }),
      ).resolves.not.toThrow();
    });

    it('compensate runs release logic when fundsReserved=true', async () => {
      const step = factory.build()[0];
      // Should not throw; actual WalletService call is a stub
      await expect(
        step.compensate({ ...baseCtx(), fundsReserved: true }),
      ).resolves.not.toThrow();
    });
  });

  // ── Step 2: persist_trade ─────────────────────────────────────────────────

  describe('persist_trade step', () => {
    it('execute creates and saves a trade, returns tradeId', async () => {
      const trade = mockTrade('trade-42');
      tradeRepo.create!.mockReturnValue(trade);
      tradeRepo.save!.mockResolvedValue(trade);

      const step = factory.build()[1];
      const patch = await step.execute(baseCtx());

      expect(tradeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          status: TradeStatus.EXECUTING,
        }),
      );
      expect(patch.tradeId).toBe('trade-42');
    });

    it('compensate marks trade as FAILED', async () => {
      const step = factory.build()[1];
      await step.compensate({ ...baseCtx(), tradeId: 'trade-42' });

      expect(tradeRepo.update).toHaveBeenCalledWith('trade-42', {
        status: TradeStatus.FAILED,
        errorMessage: expect.stringContaining('compensation'),
      });
    });

    it('compensate is a no-op when tradeId is absent', async () => {
      const step = factory.build()[1];
      await expect(step.compensate(baseCtx())).resolves.not.toThrow();
      expect(tradeRepo.update).not.toHaveBeenCalled();
    });
  });

  // ── Step 3: soroban_execution ─────────────────────────────────────────────

  describe('soroban_execution step', () => {
    it('execute returns txHash/executedPrice on success', async () => {
      const trade = mockTrade('trade-1');
      tradeRepo.findOneOrFail!.mockResolvedValue(trade);
      tradeExecutor.executeTrade!.mockResolvedValue({
        success: true,
        transactionHash: 'abc123',
        executedPrice: '0.155',
        feeAmount: '0.001',
        contractId: 'C_CONTRACT_1',
      });

      const step = factory.build()[2];
      const patch = await step.execute({ ...baseCtx(), tradeId: 'trade-1' });

      expect(patch.txHash).toBe('abc123');
      expect(patch.executedPrice).toBe('0.155');
    });

    it('execute throws BadRequestException when execution fails', async () => {
      const trade = mockTrade('trade-1');
      tradeRepo.findOneOrFail!.mockResolvedValue(trade);
      tradeExecutor.executeTrade!.mockResolvedValue({
        success: false,
        error: 'Insufficient balance',
      });

      const step = factory.build()[2];
      await expect(
        step.execute({ ...baseCtx(), tradeId: 'trade-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('execute throws when tradeId is missing', async () => {
      const step = factory.build()[2];
      await expect(step.execute(baseCtx())).rejects.toThrow(
        'tradeId missing before soroban_execution',
      );
    });

    it('compensate logs reversal without throwing (best-effort)', async () => {
      const step = factory.build()[2];
      await expect(
        step.compensate({ ...baseCtx(), tradeId: 'trade-1', txHash: 'abc123' }),
      ).resolves.not.toThrow();
    });

    it('compensate is a no-op when txHash absent', async () => {
      const step = factory.build()[2];
      await expect(
        step.compensate({ ...baseCtx(), tradeId: 'trade-1' }),
      ).resolves.not.toThrow();
    });
  });

  // ── Step 4: update_portfolio ──────────────────────────────────────────────

  describe('update_portfolio step', () => {
    it('execute records velocity and sets velocityRecorded=true', async () => {
      const step = factory.build()[3];
      const patch = await step.execute({
        ...baseCtx(),
        tradeId: 'trade-1',
        executedPrice: '0.155',
      });

      expect(velocityRisk.recordTradeExecution).toHaveBeenCalledWith({
        userId: 'user-1',
        asset: 'XLM/USDC',
        amount: 100,
        entryPrice: 0.155,
      });
      expect(patch.velocityRecorded).toBe(true);
    });

    it('execute falls back to entryPrice when executedPrice is absent', async () => {
      const step = factory.build()[3];
      await step.execute({ ...baseCtx(), tradeId: 'trade-1' });

      expect(velocityRisk.recordTradeExecution).toHaveBeenCalledWith(
        expect.objectContaining({ entryPrice: 0.15 }),
      );
    });

    it('execute throws when tradeId is missing', async () => {
      const step = factory.build()[3];
      await expect(step.execute(baseCtx())).rejects.toThrow(
        'tradeId missing before update_portfolio',
      );
    });

    it('compensate is a no-op when velocityRecorded is false', async () => {
      const step = factory.build()[3];
      await expect(
        step.compensate({ ...baseCtx(), velocityRecorded: false }),
      ).resolves.not.toThrow();
    });
  });

  // ── Step 5: finalize_trade ────────────────────────────────────────────────

  describe('finalize_trade step', () => {
    it('execute updates trade to COMPLETED with execution details', async () => {
      const step = factory.build()[4];
      await step.execute({
        ...baseCtx(),
        tradeId: 'trade-1',
        txHash: 'hash-xyz',
        executedPrice: '0.156',
        feeAmount: '0.0001',
        contractId: 'C_CONTRACT',
      });

      expect(tradeRepo.update).toHaveBeenCalledWith('trade-1', {
        status: TradeStatus.COMPLETED,
        transactionHash: 'hash-xyz',
        sorobanContractId: 'C_CONTRACT',
        feeAmount: '0.0001',
        entryPrice: '0.156',
        totalValue: expect.any(String),
        executedAt: expect.any(Date),
      });
    });

    it('execute throws when tradeId is missing', async () => {
      const step = factory.build()[4];
      await expect(step.execute(baseCtx())).rejects.toThrow(
        'tradeId missing before finalize_trade',
      );
    });

    it('compensate marks trade FAILED', async () => {
      const step = factory.build()[4];
      await step.compensate({ ...baseCtx(), tradeId: 'trade-1' });

      expect(tradeRepo.update).toHaveBeenCalledWith('trade-1', {
        status: TradeStatus.FAILED,
        errorMessage: expect.stringContaining('compensation'),
      });
    });

    it('compensate is a no-op when tradeId absent', async () => {
      const step = factory.build()[4];
      await expect(step.compensate(baseCtx())).resolves.not.toThrow();
      expect(tradeRepo.update).not.toHaveBeenCalled();
    });
  });

  // ── Full saga simulation: failure at each step position ──────────────────

  describe('step failure at each position leaves correct state', () => {
    /**
     * Simulates running steps manually and validates compensation calls
     * happen for the right steps in each failure scenario.
     */
    it('failure at soroban_execution compensates reserve_funds and persist_trade', async () => {
      const trade = mockTrade('trade-99');
      tradeRepo.create!.mockReturnValue(trade);
      tradeRepo.save!.mockResolvedValue(trade);
      tradeRepo.findOneOrFail!.mockResolvedValue(trade);
      tradeExecutor.executeTrade!.mockResolvedValue({
        success: false,
        error: 'Contract reverted',
      });

      const steps = factory.build();
      let ctx = baseCtx();

      // Step 1 (reserve_funds) — succeeds
      ctx = { ...ctx, ...(await steps[0].execute(ctx)) };
      // Step 2 (persist_trade) — succeeds
      ctx = { ...ctx, ...(await steps[1].execute(ctx)) };
      // Step 3 (soroban_execution) — fails
      await expect(steps[2].execute(ctx)).rejects.toThrow(BadRequestException);

      // Compensations run in reverse: step2, step1
      await steps[1].compensate(ctx); // persist_trade compensation
      await steps[0].compensate(ctx); // reserve_funds compensation

      expect(tradeRepo.update).toHaveBeenCalledWith(
        'trade-99',
        expect.objectContaining({ status: TradeStatus.FAILED }),
      );
    });
  });
});
