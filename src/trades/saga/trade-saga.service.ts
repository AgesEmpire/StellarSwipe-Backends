import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { TradeSagaOrchestrator } from './trade-saga.orchestrator';
import { TradeSagaStepsFactory, TradeSagaContext } from './trade-saga.steps';
import { TradeSagaEntity } from './trade-saga.entity';
import { ExecuteTradeDto } from '../dto/execute-trade.dto';

export interface TradeSagaResult {
  success: boolean;
  traceId: string;
  sagaId: string;
  tradeId?: string;
  txHash?: string;
  executedPrice?: string;
  feeAmount?: string;
  error?: string;
}

@Injectable()
export class TradeSagaService {
  private readonly logger = new Logger(TradeSagaService.name);

  constructor(
    private readonly orchestrator: TradeSagaOrchestrator,
    private readonly stepsFactory: TradeSagaStepsFactory,
  ) {}

  /**
   * Entry-point for executing a trade via the saga pattern.
   * Creates a persisted saga, runs all steps, and returns a structured result.
   */
  async executeTradeSaga(
    dto: ExecuteTradeDto & {
      baseAsset: string;
      counterAsset: string;
      entryPrice: string;
    },
  ): Promise<TradeSagaResult> {
    const traceId = uuidv4();

    this.logger.log(
      `[${traceId}] Starting trade saga for user=${dto.userId} signal=${dto.signalId}`,
    );

    const saga: TradeSagaEntity = await this.orchestrator.createSaga(
      dto.userId,
      traceId,
      { userId: dto.userId, signalId: dto.signalId, amount: dto.amount },
    );

    const initialCtx: TradeSagaContext = {
      userId: dto.userId,
      signalId: dto.signalId,
      side: dto.side as string,
      amount: dto.amount,
      walletAddress: dto.walletAddress,
      baseAsset: dto.baseAsset,
      counterAsset: dto.counterAsset,
      entryPrice: dto.entryPrice,
      stopLossPrice: dto.stopLossPrice?.toString(),
      takeProfitPrice: dto.takeProfitPrice?.toString(),
      orderType: 'market',
      traceId,
    };

    try {
      const finalCtx = await this.orchestrator.run(
        saga,
        this.stepsFactory.build(),
        initialCtx,
      );

      return {
        success: true,
        traceId,
        sagaId: saga.id,
        tradeId: finalCtx.tradeId,
        txHash: finalCtx.txHash,
        executedPrice: finalCtx.executedPrice,
        feeAmount: finalCtx.feeAmount,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Saga failed';
      this.logger.error(`[${traceId}] Trade saga failed: ${message}`);

      return {
        success: false,
        traceId,
        sagaId: saga.id,
        error: message,
      };
    }
  }
}
