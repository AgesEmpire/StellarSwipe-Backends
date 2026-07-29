import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade, TradeStatus, TradeSide } from './entities/trade.entity';
import {
  ExecuteTradeDto,
  CloseTradeDto,
  GetUserTradesDto,
} from './dto/execute-trade.dto';
import {
  TradeResultDto,
  TradeDetailsDto,
  TradeValidationResultDto,
  UserTradesSummaryDto,
  CloseTradeResultDto,
} from './dto/trade-result.dto';
import {
  RiskManagerService,
  UserBalance,
} from './services/risk-manager.service';
import { TradeExecutorService } from './services/trade-executor.service';
import { RiskManagerService as VelocityRiskManager } from '../risk/risk-manager.service';
import { ComplianceRuleEngineService } from '../compliance/rule-engine/compliance-rule-engine.service';
import {
  TradeLatencyService,
  TradeStage,
} from './services/trade-latency.service';
import { SlippageGuardService } from './services/slippage-guard.service';

interface SignalData {
  id: string;
  entryPrice: string;
  status: string;
  expiresAt: Date;
  baseAsset: string;
  counterAsset: string;
  stopLossPrice?: string;
  targetPrice?: string;
}

@Injectable()
export class TradesService {
  private readonly logger = new Logger(TradesService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    private readonly riskManager: RiskManagerService,
    private readonly tradeExecutor: TradeExecutorService,
    private readonly velocityRiskManager: VelocityRiskManager,
    private readonly complianceRuleEngine: ComplianceRuleEngineService,
    private readonly tradeLatency: TradeLatencyService,
    private readonly slippageGuard: SlippageGuardService,
  ) {}

  async executeTrade(dto: ExecuteTradeDto): Promise<TradeResultDto> {
    this.logger.log(
      `Executing trade for user ${dto.userId}, signal ${dto.signalId}`,
    );

    // Use a temporary flow ID until the persisted trade ID is available
    const tempFlowId = `${dto.userId}-${dto.signalId}-${Date.now()}`;
    this.tradeLatency.startFlow(tempFlowId);

    try {
      // ── Stage: VALIDATION ──────────────────────────────────────────────────
      const signalData = await this.tradeLatency.measureStage(
        tempFlowId,
        TradeStage.VALIDATION,
        async () => {
          const isDuplicate = await this.riskManager.checkDuplicateTrade(
            dto.userId,
            dto.signalId,
          );
          if (isDuplicate) {
            throw new BadRequestException(
              'A pending trade already exists for this signal',
            );
          }

          const signal = await this.getSignalData(dto.signalId);
          const userBalance = await this.getUserBalance(dto.userId);

          await this.complianceRuleEngine.evaluateTrade({
            userId: dto.userId,
            amount: dto.amount,
            asset: signal.baseAsset,
            counterAsset: signal.counterAsset,
          });

          const validation = await this.riskManager.validateTrade(
            dto,
            signal,
            userBalance,
          );
          if (!validation.isValid) {
            throw new BadRequestException({
              message: 'Trade validation failed',
              errors: validation.errors,
            });
          }

          await this.velocityRiskManager.validateTrade(
            {
              userId: dto.userId,
              asset: `${signal.baseAsset}/${signal.counterAsset}`,
              amount: dto.amount,
              entryPrice: parseFloat(signal.entryPrice),
              stopLossPrice: dto.stopLossPrice,
            },
            0,
            0,
            parseFloat(userBalance.available),
          );

          // Slippage Guard Check
          const sellingAsset = dto.side === TradeSide.BUY ? signal.counterAsset : signal.baseAsset;
          const buyingAsset = dto.side === TradeSide.BUY ? signal.baseAsset : signal.counterAsset;
          
          let referencePrice = parseFloat(signal.entryPrice);
          if (dto.side === TradeSide.SELL) {
            // Orderbook price for SELL is base / counter, so we invert the entry price (which is counter / base)
            referencePrice = 1 / referencePrice;
          }
          
          // Slippage tolerance from DTO is in percentage, guard expects basis points
          // e.g., 0.5% * 100 = 50 bps. So we multiply by 100 if provided.
          const overrideBps = dto.slippageTolerance !== undefined ? dto.slippageTolerance * 100 : undefined;
          
          await this.slippageGuard.verifySlippage(
            sellingAsset,
            buyingAsset,
            referencePrice,
            overrideBps,
          );

          return { signal, userBalance };
        },
      );

      const { signal: signalData_ } = signalData;

      // ── Stage: CREATION ────────────────────────────────────────────────────
      const trade = await this.tradeLatency.measureStage(
        tempFlowId,
        TradeStage.CREATION,
        async () => {
          const newTrade = this.tradeRepository.create({
            userId: dto.userId,
            signalId: dto.signalId,
            side: dto.side,
            baseAsset: signalData_.baseAsset,
            counterAsset: signalData_.counterAsset,
            entryPrice: signalData_.entryPrice,
            amount: dto.amount.toString(),
            totalValue: (
              dto.amount * parseFloat(signalData_.entryPrice)
            ).toFixed(8),
            stopLossPrice:
              dto.stopLossPrice?.toString() || signalData_.stopLossPrice,
            takeProfitPrice:
              dto.takeProfitPrice?.toString() || signalData_.targetPrice,
            status: TradeStatus.PENDING,
          });
          await this.tradeRepository.save(newTrade);
          newTrade.status = TradeStatus.EXECUTING;
          await this.tradeRepository.save(newTrade);
          return newTrade;
        },
      );

      // ── Stage: EXECUTION ───────────────────────────────────────────────────
      const executionResult = await this.tradeLatency.measureStage(
        trade.id,
        TradeStage.EXECUTION,
        () => this.tradeExecutor.executeTrade(trade, dto.walletAddress),
      );

      if (executionResult.success) {
        // ── Stage: CONFIRMATION ──────────────────────────────────────────────
        await this.tradeLatency.measureStage(
          trade.id,
          TradeStage.CONFIRMATION,
          async () => {
            trade.status = TradeStatus.COMPLETED;
            trade.transactionHash = executionResult.transactionHash;
            trade.sorobanContractId = executionResult.contractId;
            trade.feeAmount = executionResult.feeAmount || '0';
            trade.executedAt = new Date();

            if (executionResult.executedPrice) {
              trade.entryPrice = executionResult.executedPrice;
              trade.totalValue = (
                parseFloat(trade.amount) *
                parseFloat(executionResult.executedPrice)
              ).toFixed(8);
            }

            await this.tradeRepository.save(trade);

            await this.velocityRiskManager.recordTradeExecution({
              userId: trade.userId,
              asset: `${trade.baseAsset}/${trade.counterAsset}`,
              amount: parseFloat(trade.amount),
              entryPrice: parseFloat(trade.entryPrice),
            });
          },
        );

        this.tradeLatency.endFlow(trade.id, 'success');
        this.logger.log(
          `Trade ${trade.id} executed successfully. Hash: ${trade.transactionHash}`,
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
        };
      } else {
        trade.status = TradeStatus.FAILED;
        trade.errorMessage = executionResult.error;
        await this.tradeRepository.save(trade);

        this.tradeLatency.endFlow(trade.id, 'failure');
        this.logger.error(`Trade ${trade.id} failed: ${executionResult.error}`);

        throw new BadRequestException({
          message: 'Trade execution failed',
          error: executionResult.error,
          tradeId: trade.id,
        });
      }
    } catch (error) {
      // Ensure the flow is always finalised even on unexpected errors
      this.tradeLatency.endFlow(tempFlowId, 'failure');
      throw error;
    }
  }

  async closeTrade(dto: CloseTradeDto): Promise<CloseTradeResultDto> {
    const trade = await this.tradeRepository.findOne({
      where: { id: dto.tradeId, userId: dto.userId },
    });

    if (!trade) {
      throw new NotFoundException('Trade not found');
    }

    if (trade.status !== TradeStatus.COMPLETED || trade.closedAt) {
      throw new BadRequestException(
        'Trade cannot be closed. It must be in completed status and not already closed.',
      );
    }

    // Get current market price or use provided exit price
    const exitPrice =
      dto.exitPrice?.toString() ||
      (await this.getCurrentPrice(trade.baseAsset, trade.counterAsset));

    // Execute close on Soroban
    const closeResult = await this.tradeExecutor.closeTrade(trade, exitPrice);

    if (closeResult.success) {
      const { profitLoss, profitLossPercentage } =
        this.riskManager.calculateProfitLoss(
          trade.entryPrice,
          exitPrice,
          trade.amount,
          trade.side === TradeSide.BUY ? 'buy' : 'sell',
        );

      trade.exitPrice = exitPrice;
      trade.profitLoss = profitLoss;
      trade.profitLossPercentage = profitLossPercentage;
      trade.closedAt = new Date();

      await this.tradeRepository.save(trade);

      // Handle large loss for velocity tracking
      if (parseFloat(profitLoss) < -1000) {
        // Loss threshold
        await this.velocityRiskManager.handleTradeLoss(
          trade.userId,
          Math.abs(parseFloat(profitLoss)),
        );
      }

      this.logger.log(
        `Trade ${trade.id} closed. P&L: ${profitLoss} (${profitLossPercentage}%)`,
      );

      return {
        id: trade.id,
        status: trade.status,
        exitPrice,
        profitLoss,
        profitLossPercentage,
        transactionHash: closeResult.transactionHash,
        closedAt: trade.closedAt,
        message: 'Trade closed successfully',
      };
    } else {
      throw new BadRequestException({
        message: 'Failed to close trade',
        error: closeResult.error,
      });
    }
  }

  async getTradeById(
    tradeId: string,
    userId: string,
  ): Promise<TradeDetailsDto> {
    const trade = await this.tradeRepository.findOne({
      where: { id: tradeId, userId },
    });

    if (!trade) {
      throw new NotFoundException('Trade not found');
    }

    return this.mapToTradeDetails(trade);
  }

  async getUserTrades(dto: GetUserTradesDto): Promise<TradeDetailsDto[]> {
    const query = this.tradeRepository
      .createQueryBuilder('trade')
      .where('trade.user_id = :userId', { userId: dto.userId })
      .orderBy('trade.created_at', 'DESC');

    if (dto.status && dto.status !== 'all') {
      query.andWhere('trade.status = :status', { status: dto.status });
    }

    if (dto.limit) {
      query.take(dto.limit);
    }

    if (dto.offset) {
      query.skip(dto.offset);
    }

    const trades = await query.getMany();
    return trades.map((trade) => this.mapToTradeDetails(trade));
  }

  async getUserTradesSummary(userId: string): Promise<UserTradesSummaryDto> {
    const trades = await this.tradeRepository.find({
      where: { userId },
    });

    const totalTrades = trades.length;
    const openTrades = trades.filter(
      (t) => t.status === TradeStatus.COMPLETED && !t.closedAt,
    ).length;
    const completedTrades = trades.filter((t) => t.closedAt).length;
    const failedTrades = trades.filter(
      (t) => t.status === TradeStatus.FAILED,
    ).length;

    const closedTrades = trades.filter((t) => t.closedAt && t.profitLoss);
    const totalProfitLoss = closedTrades.reduce(
      (sum, t) => sum + parseFloat(t.profitLoss || '0'),
      0,
    );
    const winningTrades = closedTrades.filter(
      (t) => parseFloat(t.profitLoss || '0') > 0,
    ).length;
    const winRate =
      closedTrades.length > 0 ? (winningTrades / closedTrades.length) * 100 : 0;
    const averageProfitLoss =
      closedTrades.length > 0 ? totalProfitLoss / closedTrades.length : 0;

    return {
      totalTrades,
      openTrades,
      completedTrades,
      failedTrades,
      totalProfitLoss: totalProfitLoss.toFixed(8),
      winRate: winRate.toFixed(2),
      averageProfitLoss: averageProfitLoss.toFixed(8),
    };
  }

  async validateTradePreview(
    dto: ExecuteTradeDto,
  ): Promise<TradeValidationResultDto> {
    const signalData = await this.getSignalData(dto.signalId);
    const userBalance = await this.getUserBalance(dto.userId);
    return this.riskManager.validateTrade(dto, signalData, userBalance);
  }

  async getOpenPositions(userId: string): Promise<TradeDetailsDto[]> {
    const trades = await this.tradeRepository.find({
      where: {
        userId,
        status: TradeStatus.COMPLETED,
      },
    });

    return trades
      .filter((t) => !t.closedAt)
      .map((trade) => this.mapToTradeDetails(trade));
  }

  async getTradesBySignal(signalId: string): Promise<TradeDetailsDto[]> {
    const trades = await this.tradeRepository.find({
      where: { signalId },
      order: { createdAt: 'DESC' },
    });

    return trades.map((trade) => this.mapToTradeDetails(trade));
  }

  private mapToTradeDetails(trade: Trade): TradeDetailsDto {
    return {
      id: trade.id,
      userId: trade.userId,
      signalId: trade.signalId,
      status: trade.status,
      side: trade.side,
      baseAsset: trade.baseAsset,
      counterAsset: trade.counterAsset,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      amount: trade.amount,
      totalValue: trade.totalValue,
      feeAmount: trade.feeAmount,
      profitLoss: trade.profitLoss,
      profitLossPercentage: trade.profitLossPercentage,
      stopLossPrice: trade.stopLossPrice,
      takeProfitPrice: trade.takeProfitPrice,
      transactionHash: trade.transactionHash,
      sorobanContractId: trade.sorobanContractId,
      errorMessage: trade.errorMessage,
      executedAt: trade.executedAt,
      closedAt: trade.closedAt,
      createdAt: trade.createdAt,
      updatedAt: trade.updatedAt,
    };
  }

  // Mock methods - in production, these would call other services
  private async getSignalData(signalId: string): Promise<SignalData> {
    // In production, call SignalsService to get actual signal data
    return {
      id: signalId,
      entryPrice: '0.15000000',
      status: 'active',
      expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      baseAsset: 'XLM',
      counterAsset: 'USDC',
      stopLossPrice: '0.14000000',
      targetPrice: '0.18000000',
    };
  }

  private async getUserBalance(_userId: string): Promise<UserBalance> {
    // In production, call UserService/WalletService to get actual balance
    return {
      available: '10000.00000000',
      locked: '0.00000000',
      total: '10000.00000000',
    };
  }

  private async getCurrentPrice(
    _baseAsset: string,
    _counterAsset: string,
  ): Promise<string> {
    // In production, call price feed service
    return '0.16000000';
  }
}
