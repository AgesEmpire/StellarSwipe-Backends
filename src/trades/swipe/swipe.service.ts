import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { SwipeIntentDto, SwipeSource } from './dto/swipe-intent.dto';
import {
  TradeExecutionOrchestratorService,
  OrchestratorResult,
} from '../services/trade-execution-orchestrator.service';

@Injectable()
export class SwipeService {
  private readonly logger = new Logger(SwipeService.name);

  constructor(
    private readonly orchestrator: TradeExecutionOrchestratorService,
  ) {}

  /**
   * Accepts a swipe intent from any input source (gesture, keyboard, button)
   * and delegates to the trade execution orchestrator.
   * Response semantics are identical regardless of source.
   */
  async handleSwipe(dto: SwipeIntentDto): Promise<OrchestratorResult> {
    this.guardButtonConfirmation(dto);

    this.logger.log(
      `Swipe received: user=${dto.userId} signal=${dto.signalId} source=${dto.source}` +
        (dto.shortcutKey ? ` shortcut=${dto.shortcutKey}` : ''),
    );

    const result = await this.orchestrator.orchestrate({
      userId: dto.userId,
      signalId: dto.signalId,
      side: dto.side,
      amount: dto.amount,
      stopLossPrice: dto.stopLossPrice,
      takeProfitPrice: dto.takeProfitPrice,
      slippageTolerance: dto.slippageTolerance,
      walletAddress: dto.walletAddress,
      orderTypeOverride: dto.orderTypeOverride,
      source: dto.source,
    });

    if (!result.success) {
      throw new BadRequestException({
        message: result.error ?? 'Swipe trade execution failed',
        traceId: result.traceId,
        stages: result.stages,
      });
    }

    return result;
  }

  /**
   * Button-sourced actions require explicit confirmation to prevent accidental
   * execution from UI mis-clicks.
   */
  private guardButtonConfirmation(dto: SwipeIntentDto): void {
    if (dto.source === SwipeSource.BUTTON && !dto.confirmAction) {
      throw new BadRequestException(
        'Button-sourced swipe requires confirmAction=true',
      );
    }
  }
}
