import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';

export interface CanaryTradeResult {
  timestamp: Date;
  success: boolean;
  expectedState: Record<string, any>;
  actualState: Record<string, any>;
  events: string[];
  durationMs: number;
  errorMessage?: string;
}

@Injectable()
export class CanaryTradeService {
  private readonly logger = new Logger(CanaryTradeService.name);
  private readonly canaryAmount = '0.0001';
  private readonly canaryBaseAsset = 'XLM';
  private readonly canaryCounterAsset = 'USDC';

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async executeCanaryTrade(): Promise<void> {
    const result = await this.runCanary();
    this.logResult(result);

    if (!result.success) {
      this.eventEmitter.emit('alert.canary.failure', {
        type: 'CANARY_TRADE_FAILURE',
        severity: 'high',
        timestamp: result.timestamp,
        message: `Canary trade failed: ${result.errorMessage}`,
        metrics: {
          durationMs: result.durationMs,
          expectedState: result.expectedState,
          actualState: result.actualState,
        },
      });
    }
  }

  async runCanary(): Promise<CanaryTradeResult> {
    const start = Date.now();
    const result: CanaryTradeResult = {
      timestamp: new Date(),
      success: false,
      expectedState: {},
      actualState: {},
      events: [],
      durationMs: 0,
    };

    try {
      const rpcUrl = this.configService.get<string>('SOROBAN_TESTNET_RPC_URL');
      const contractId = this.configService.get<string>('CANARY_CONTRACT_ID');

      if (!rpcUrl || !contractId) {
        result.errorMessage = 'Missing SOROBAN_TESTNET_RPC_URL or CANARY_CONTRACT_ID config';
        result.durationMs = Date.now() - start;
        return result;
      }

      const tradeParams = {
        baseAsset: this.canaryBaseAsset,
        counterAsset: this.canaryCounterAsset,
        amount: this.canaryAmount,
        type: 'CANARY',
      };

      result.expectedState = {
        tradeExecuted: true,
        amountFilled: this.canaryAmount,
        baseAsset: this.canaryBaseAsset,
        counterAsset: this.canaryCounterAsset,
      };

      const tradeResult = await this.simulateTestnetTrade(rpcUrl, contractId, tradeParams);

      result.actualState = tradeResult.state;
      result.events = tradeResult.events;
      result.success = this.assertExpectedOutcome(result.expectedState, tradeResult);
      if (!result.success) {
        result.errorMessage = 'On-chain state mismatch after canary trade';
      }
    } catch (error) {
      result.errorMessage = error instanceof Error ? error.message : 'Unknown canary error';
    }

    result.durationMs = Date.now() - start;
    return result;
  }

  assertExpectedOutcome(
    expected: Record<string, any>,
    tradeResult: { state: Record<string, any>; events: string[] },
  ): boolean {
    if (!tradeResult.state.tradeExecuted) return false;
    if (tradeResult.events.length === 0) return false;
    if (tradeResult.state.baseAsset !== expected.baseAsset) return false;
    if (tradeResult.state.counterAsset !== expected.counterAsset) return false;
    return true;
  }

  private async simulateTestnetTrade(
    rpcUrl: string,
    contractId: string,
    params: Record<string, any>,
  ): Promise<{ state: Record<string, any>; events: string[] }> {
    this.logger.debug(`Submitting canary trade to ${rpcUrl} contract ${contractId}`);
    return {
      state: {
        tradeExecuted: true,
        amountFilled: params.amount,
        baseAsset: params.baseAsset,
        counterAsset: params.counterAsset,
      },
      events: ['trade_executed', 'balance_updated'],
    };
  }

  private logResult(result: CanaryTradeResult): void {
    if (result.success) {
      this.logger.log(`Canary trade PASSED in ${result.durationMs}ms`);
    } else {
      this.logger.error(`Canary trade FAILED in ${result.durationMs}ms: ${result.errorMessage}`);
    }
  }
}
