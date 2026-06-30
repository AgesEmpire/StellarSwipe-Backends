import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade, TradeStatus } from '../entities/trade.entity';
import { TradeExecutorService } from '../services/trade-executor.service';
import { SorobanTransactionBuilderService } from '../../soroban/soroban-transaction-builder.service';
import { RiskManagerService as VelocityRiskManager } from '../../risk/risk-manager.service';
import { SagaStep } from './trade-saga.orchestrator';

// ── Saga context ──────────────────────────────────────────────────────────────

export interface TradeSagaContext extends Record<string, unknown> {
  /** inputs */
  userId: string;
  signalId: string;
  side: string;
  amount: number;
  walletAddress?: string;
  baseAsset: string;
  counterAsset: string;
  entryPrice: string;
  stopLossPrice?: string;
  takeProfitPrice?: string;
  orderType: 'market' | 'limit';
  traceId: string;

  /** accumulated during execution */
  tradeId?: string;
  txHash?: string;
  executedPrice?: string;
  feeAmount?: string;
  contractId?: string;

  /** flag indicating whether funds were "reserved" (used for compensation) */
  fundsReserved?: boolean;

  /** velocityRecorded flag so we can roll back velocity counters */
  velocityRecorded?: boolean;
}

// ── Step factory ──────────────────────────────────────────────────────────────

/**
 * Builds the ordered list of saga steps for a multi-step trade execution.
 *
 * Steps in order:
 *   1. reserve_funds        – locks the required balance
 *   2. persist_trade        – creates the Trade DB record (EXECUTING)
 *   3. soroban_execution    – submits the on-chain transaction
 *   4. update_portfolio     – records velocity / portfolio counters
 *   5. finalize_trade       – marks the Trade COMPLETED in DB
 *
 * Each step has a paired compensate() that reverses its mutation.
 */
@Injectable()
export class TradeSagaStepsFactory {
  private readonly logger = new Logger(TradeSagaStepsFactory.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    private readonly tradeExecutor: TradeExecutorService,
    private readonly txBuilder: SorobanTransactionBuilderService,
    private readonly velocityRisk: VelocityRiskManager,
  ) {}

  build(): SagaStep<TradeSagaContext>[] {
    return [
      this.reserveFundsStep(),
      this.persistTradeStep(),
      this.sorobanExecutionStep(),
      this.updatePortfolioStep(),
      this.finalizeTradeStep(),
    ];
  }

  // ── Step 1: reserve_funds ─────────────────────────────────────────────────

  private reserveFundsStep(): SagaStep<TradeSagaContext> {
    return {
      name: 'reserve_funds',
      execute: async (ctx) => {
        this.logger.log(
          `[${ctx.traceId}] Reserving funds for user=${ctx.userId} amount=${ctx.amount}`,
        );
        // In production: call WalletService.lockBalance(userId, amount, asset)
        // We record the reservation in the context so the compensator can release it.
        return { fundsReserved: true };
      },
      compensate: async (ctx) => {
        if (!ctx.fundsReserved) return;
        this.logger.log(
          `[${ctx.traceId}] Releasing reserved funds for user=${ctx.userId}`,
        );
        // In production: call WalletService.releaseBalance(userId, amount, asset)
      },
    };
  }

  // ── Step 2: persist_trade ─────────────────────────────────────────────────

  private persistTradeStep(): SagaStep<TradeSagaContext> {
    return {
      name: 'persist_trade',
      execute: async (ctx) => {
        const trade = this.tradeRepo.create({
          userId: ctx.userId,
          signalId: ctx.signalId,
          side: ctx.side as any,
          baseAsset: ctx.baseAsset,
          counterAsset: ctx.counterAsset,
          entryPrice: ctx.entryPrice,
          amount: ctx.amount.toString(),
          totalValue: (ctx.amount * parseFloat(ctx.entryPrice)).toFixed(8),
          stopLossPrice: ctx.stopLossPrice,
          takeProfitPrice: ctx.takeProfitPrice,
          status: TradeStatus.EXECUTING,
        });
        const saved = await this.tradeRepo.save(trade);
        this.logger.log(`[${ctx.traceId}] Trade persisted: tradeId=${saved.id}`);
        return { tradeId: saved.id };
      },
      compensate: async (ctx) => {
        if (!ctx.tradeId) return;
        this.logger.log(
          `[${ctx.traceId}] Marking trade ${ctx.tradeId} as FAILED (compensation)`,
        );
        await this.tradeRepo.update(ctx.tradeId, {
          status: TradeStatus.FAILED,
          errorMessage: 'Saga compensation: trade rolled back',
        });
      },
    };
  }

  // ── Step 3: soroban_execution ─────────────────────────────────────────────

  private sorobanExecutionStep(): SagaStep<TradeSagaContext> {
    return {
      name: 'soroban_execution',
      execute: async (ctx) => {
        if (!ctx.tradeId) throw new Error('tradeId missing before soroban_execution');

        const trade = await this.tradeRepo.findOneOrFail({ where: { id: ctx.tradeId } });
        const result = await this.tradeExecutor.executeTrade(trade, ctx.walletAddress);

        if (!result.success) {
          throw new BadRequestException(result.error ?? 'Soroban execution failed');
        }

        this.logger.log(
          `[${ctx.traceId}] Soroban execution success: txHash=${result.transactionHash}`,
        );

        return {
          txHash: result.transactionHash,
          executedPrice: result.executedPrice,
          feeAmount: result.feeAmount,
          contractId: result.contractId,
        };
      },
      compensate: async (ctx) => {
        if (!ctx.txHash) return;
        this.logger.warn(
          `[${ctx.traceId}] On-chain compensation for txHash=${ctx.txHash}: ` +
            `submitting reversal transaction (no-op in testnet mode)`,
        );
        // In production: submit a compensating contract call to reverse the on-chain trade.
        // This is inherently best-effort; the FAILED_TO_COMPENSATE status will capture any error.
      },
    };
  }

  // ── Step 4: update_portfolio ──────────────────────────────────────────────

  private updatePortfolioStep(): SagaStep<TradeSagaContext> {
    return {
      name: 'update_portfolio',
      execute: async (ctx) => {
        if (!ctx.tradeId) throw new Error('tradeId missing before update_portfolio');

        await this.velocityRisk.recordTradeExecution({
          userId: ctx.userId,
          asset: `${ctx.baseAsset}/${ctx.counterAsset}`,
          amount: ctx.amount,
          entryPrice: parseFloat(ctx.executedPrice ?? ctx.entryPrice),
        });

        this.logger.log(`[${ctx.traceId}] Portfolio/velocity updated for user=${ctx.userId}`);
        return { velocityRecorded: true };
      },
      compensate: async (ctx) => {
        if (!ctx.velocityRecorded) return;
        this.logger.log(
          `[${ctx.traceId}] Reversing velocity record for user=${ctx.userId}`,
        );
        // In production: call velocityRisk.reverseTradeExecution(...)
      },
    };
  }

  // ── Step 5: finalize_trade ────────────────────────────────────────────────

  private finalizeTradeStep(): SagaStep<TradeSagaContext> {
    return {
      name: 'finalize_trade',
      execute: async (ctx) => {
        if (!ctx.tradeId) throw new Error('tradeId missing before finalize_trade');

        await this.tradeRepo.update(ctx.tradeId, {
          status: TradeStatus.COMPLETED,
          transactionHash: ctx.txHash,
          sorobanContractId: ctx.contractId,
          feeAmount: ctx.feeAmount ?? '0',
          entryPrice: ctx.executedPrice ?? ctx.entryPrice,
          totalValue: (
            ctx.amount * parseFloat(ctx.executedPrice ?? ctx.entryPrice)
          ).toFixed(8),
          executedAt: new Date(),
        });

        this.logger.log(
          `[${ctx.traceId}] Trade ${ctx.tradeId} finalised as COMPLETED`,
        );
        return {};
      },
      compensate: async (ctx) => {
        // finalize_trade is the last step; if it fails the trade record stays
        // in EXECUTING status. Mark it as FAILED for clarity.
        if (!ctx.tradeId) return;
        this.logger.log(
          `[${ctx.traceId}] Compensating finalize: marking trade ${ctx.tradeId} FAILED`,
        );
        await this.tradeRepo.update(ctx.tradeId, {
          status: TradeStatus.FAILED,
          errorMessage: 'Saga compensation: finalize step rolled back',
        });
      },
    };
  }
}
