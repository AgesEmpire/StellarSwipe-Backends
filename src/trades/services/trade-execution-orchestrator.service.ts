import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ExecuteTradeDto } from '../dto/execute-trade.dto';
import { TradeResultDto } from '../dto/trade-result.dto';
import { RiskManagerService, UserBalance } from './risk-manager.service';
import { TradeExecutorService } from './trade-executor.service';
import { RiskManagerService as VelocityRiskManager } from '../../risk/risk-manager.service';
import { ComplianceRuleEngineService } from '../../compliance/rule-engine/compliance-rule-engine.service';
import { SorobanTransactionBuilderService } from '../../soroban/soroban-transaction-builder.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade, TradeStatus } from '../entities/trade.entity';

export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
}

export interface TradeIntent extends ExecuteTradeDto {
  /** Origin of the trade intent: gesture swipe, keyboard shortcut, or button press */
  source?: 'gesture' | 'keyboard' | 'button';
  /** Optional short-circuit: caller-specified order type override */
  orderTypeOverride?: OrderType;
}

export interface OrchestratorResult {
  success: boolean;
  tradeId?: string;
  traceId: string;
  orderType: OrderType;
  result?: TradeResultDto;
  error?: string;
  stages: StageLog[];
}

interface StageLog {
  stage: string;
  status: 'ok' | 'failed' | 'skipped';
  durationMs: number;
  detail?: string;
}

interface SignalData {
  id: string;
  entryPrice: string;
  status: string;
  expiresAt: Date;
  baseAsset: string;
  counterAsset: string;
  stopLossPrice?: string;
  targetPrice?: string;
  /** When a limit price is specified on the signal it triggers a limit order */
  limitPrice?: string;
}

@Injectable()
export class TradeExecutionOrchestratorService {
  private readonly logger = new Logger(TradeExecutionOrchestratorService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    private readonly riskManager: RiskManagerService,
    private readonly tradeExecutor: TradeExecutorService,
    private readonly velocityRiskManager: VelocityRiskManager,
    private readonly complianceEngine: ComplianceRuleEngineService,
    private readonly txBuilder: SorobanTransactionBuilderService,
  ) {}

  async orchestrate(intent: TradeIntent): Promise<OrchestratorResult> {
    const traceId = uuidv4();
    const stages: StageLog[] = [];

    this.logger.log(
      `[${traceId}] Orchestrating trade for user=${intent.userId} signal=${intent.signalId} source=${intent.source ?? 'gesture'}`,
    );

    try {
      // ── Stage 1: Account & user validation ──────────────────────────────────
      const { signal, userBalance } = await this.runStage(
        stages,
        'account_validation',
        () => this.validateAccountState(intent, traceId),
      );

      // ── Stage 2: Risk checks ─────────────────────────────────────────────────
      await this.runStage(stages, 'risk_checks', () =>
        this.runRiskChecks(intent, signal, userBalance, traceId),
      );

      // ── Stage 3: Order type selection ────────────────────────────────────────
      const orderType = await this.runStage(stages, 'order_type_selection', () =>
        Promise.resolve(this.selectOrderType(intent, signal)),
      );

      // ── Stage 4: Transaction payload construction ────────────────────────────
      const payload = await this.runStage(
        stages,
        'transaction_build',
        async () => {
          const userRisk = { maxExposure: parseFloat(userBalance.available) * 0.2 };

          if (orderType === OrderType.LIMIT) {
            return this.txBuilder.buildLimitOrder(
              {
                userId: intent.userId,
                baseAsset: signal.baseAsset,
                counterAsset: signal.counterAsset,
                amount: intent.amount,
                limitPrice: parseFloat(signal.limitPrice ?? signal.entryPrice),
                side: intent.side,
                stopLossPrice: intent.stopLossPrice,
                takeProfitPrice: intent.takeProfitPrice,
              },
              userRisk,
            );
          }

          return this.txBuilder.buildMarketOrder(
            {
              userId: intent.userId,
              baseAsset: signal.baseAsset,
              counterAsset: signal.counterAsset,
              amount: intent.amount,
              entryPrice: parseFloat(signal.entryPrice),
              side: intent.side,
              slippageTolerance: intent.slippageTolerance,
              stopLossPrice: intent.stopLossPrice,
              takeProfitPrice: intent.takeProfitPrice,
            },
            userRisk,
          );
        },
      );

      // ── Stage 5: Persist trade record ────────────────────────────────────────
      const trade = await this.runStage(stages, 'trade_persist', async () => {
        const newTrade = this.tradeRepository.create({
          userId: intent.userId,
          signalId: intent.signalId,
          side: intent.side,
          baseAsset: signal.baseAsset,
          counterAsset: signal.counterAsset,
          entryPrice: signal.entryPrice,
          amount: intent.amount.toString(),
          totalValue: (intent.amount * parseFloat(signal.entryPrice)).toFixed(8),
          stopLossPrice: intent.stopLossPrice?.toString() ?? signal.stopLossPrice,
          takeProfitPrice: intent.takeProfitPrice?.toString() ?? signal.targetPrice,
          status: TradeStatus.EXECUTING,
        });
        return this.tradeRepository.save(newTrade);
      });

      this.logger.log(`[${traceId}] Trade persisted: tradeId=${trade.id}`);

      // ── Stage 6: Soroban contract invocation ─────────────────────────────────
      const executionResult = await this.runStage(
        stages,
        'soroban_execution',
        () => this.tradeExecutor.executeTrade(trade, intent.walletAddress),
      );

      // ── Stage 7: Finalize trade record ───────────────────────────────────────
      const result = await this.runStage(stages, 'finalize', async () => {
        if (executionResult.success) {
          trade.status = TradeStatus.COMPLETED;
          trade.transactionHash = executionResult.transactionHash;
          trade.sorobanContractId = executionResult.contractId;
          trade.feeAmount = executionResult.feeAmount ?? '0';
          trade.executedAt = new Date();

          if (executionResult.executedPrice) {
            trade.entryPrice = executionResult.executedPrice;
            trade.totalValue = (
              parseFloat(trade.amount) * parseFloat(executionResult.executedPrice)
            ).toFixed(8);
          }

          await this.tradeRepository.save(trade);

          await this.velocityRiskManager.recordTradeExecution({
            userId: trade.userId,
            asset: `${trade.baseAsset}/${trade.counterAsset}`,
            amount: parseFloat(trade.amount),
            entryPrice: parseFloat(trade.entryPrice),
          });

          this.logger.log(
            `[${traceId}] Trade ${trade.id} completed. hash=${trade.transactionHash}`,
          );

          return {
            id: trade.id,
            userId: trade.userId,
            signalId: trade.signalId,
            status: trade.status,
            side: trade.side,
            baseAsset: trade.baseAsset,
            counterAsset: trade.counterAsset,
            entryPrice: trade.entryPrice,
            amount: trade.amount,
            totalValue: trade.totalValue,
            feeAmount: trade.feeAmount,
            transactionHash: trade.transactionHash,
            executedAt: trade.executedAt,
            message: 'Trade executed successfully',
          } as TradeResultDto;
        }

        trade.status = TradeStatus.FAILED;
        trade.errorMessage = executionResult.error;
        await this.tradeRepository.save(trade);

        this.logger.error(
          `[${traceId}] Trade ${trade.id} failed: ${executionResult.error}`,
        );

        // Propagate as a domain error so runStage captures it
        throw new BadRequestException({
          message: 'Trade execution failed',
          error: executionResult.error,
          tradeId: trade.id,
        });
      });

      return {
        success: true,
        traceId,
        tradeId: result.id,
        orderType,
        result,
        stages,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Orchestration failed';

      this.logger.error(`[${traceId}] Orchestration error: ${message}`);

      return {
        success: false,
        traceId,
        orderType: intent.orderTypeOverride ?? OrderType.MARKET,
        error: message,
        stages,
      };
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async validateAccountState(
    intent: TradeIntent,
    traceId: string,
  ): Promise<{ signal: SignalData; userBalance: UserBalance }> {
    const isDuplicate = await this.riskManager.checkDuplicateTrade(
      intent.userId,
      intent.signalId,
    );
    if (isDuplicate) {
      throw new BadRequestException(
        'A pending trade already exists for this signal',
      );
    }

    const signal = await this.fetchSignalData(intent.signalId);

    const userBalance = await this.fetchUserBalance(intent.userId);

    await this.complianceEngine.evaluateTrade({
      userId: intent.userId,
      amount: intent.amount,
      asset: signal.baseAsset,
      counterAsset: signal.counterAsset,
    });

    const validation = await this.riskManager.validateTrade(
      intent,
      signal,
      userBalance,
    );
    if (!validation.isValid) {
      this.logger.warn(
        `[${traceId}] Validation failed for user=${intent.userId}: ${validation.errors.join(', ')}`,
      );
      throw new BadRequestException({
        message: 'Trade validation failed',
        errors: validation.errors,
      });
    }

    return { signal, userBalance };
  }

  private async runRiskChecks(
    intent: TradeIntent,
    signal: SignalData,
    userBalance: UserBalance,
    traceId: string,
  ): Promise<void> {
    try {
      await this.velocityRiskManager.validateTrade(
        {
          userId: intent.userId,
          asset: `${signal.baseAsset}/${signal.counterAsset}`,
          amount: intent.amount,
          entryPrice: parseFloat(signal.entryPrice),
          stopLossPrice: intent.stopLossPrice,
        },
        0,
        0,
        parseFloat(userBalance.available),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Risk check failed';
      this.logger.warn(`[${traceId}] Risk check blocked trade: ${msg}`);
      throw new BadRequestException(`Risk check failed: ${msg}`);
    }
  }

  private selectOrderType(intent: TradeIntent, signal: SignalData): OrderType {
    if (intent.orderTypeOverride) return intent.orderTypeOverride;
    return signal.limitPrice ? OrderType.LIMIT : OrderType.MARKET;
  }

  /** Runs a stage, records timing and status, and re-throws on failure */
  private async runStage<T>(
    stages: StageLog[],
    name: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      stages.push({ stage: name, status: 'ok', durationMs: Date.now() - start });
      return result;
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'unknown error';
      stages.push({
        stage: name,
        status: 'failed',
        durationMs: Date.now() - start,
        detail,
      });
      throw error;
    }
  }

  private async fetchSignalData(signalId: string): Promise<SignalData> {
    // In production delegate to SignalsService
    return {
      id: signalId,
      entryPrice: '0.15000000',
      status: 'active',
      expiresAt: new Date(Date.now() + 3_600_000),
      baseAsset: 'XLM',
      counterAsset: 'USDC',
      stopLossPrice: '0.14000000',
      targetPrice: '0.18000000',
    };
  }

  private async fetchUserBalance(_userId: string): Promise<UserBalance> {
    // In production delegate to WalletService
    return {
      available: '10000.00000000',
      locked: '0.00000000',
      total: '10000.00000000',
    };
  }
}
