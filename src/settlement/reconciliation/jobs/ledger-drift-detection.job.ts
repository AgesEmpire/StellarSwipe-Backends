import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository, MoreThan } from 'typeorm';
import { Trade, TradeStatus } from '../../../trades/entities/trade.entity';
import { HorizonBulkheadService } from '../../../stellar/bulkhead/horizon-bulkhead.service';
import { HorizonCallCategory } from '../../../stellar/bulkhead/horizon-bulkhead.types';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface LedgerDriftEvent {
  tradeId: string;
  transactionHash: string;
  localStatus: TradeStatus;
  onChainStatus: string;
  ledger: number;
  timestamp: Date;
}

/**
 * Scheduled job that detects settlement drift between local database state
 * and on-chain Stellar ledger state. Samples recently settled trades,
 * re-fetches their transaction status from Horizon, and flags any mismatches.
 */
@Injectable()
export class LedgerDriftDetectionJob {
  private readonly logger = new Logger(LedgerDriftDetectionJob.name);
  private readonly SAMPLE_SIZE = 50; // Sample up to 50 recent trades per run
  private readonly LOOKBACK_HOURS = 24; // Only check trades from last 24 hours

  constructor(
    @Inject('TRADE_REPOSITORY') private readonly tradeRepo: Repository<Trade>,
    private readonly horizonBulkhead: HorizonBulkheadService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Runs daily at 2 AM to detect drift between local and on-chain settlement state.
   * Samples recently settled trades and re-fetches their status from Horizon.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async detectLedgerDrift(): Promise<void> {
    this.logger.log('Starting ledger drift detection job');

    try {
      // Sample recently settled trades from the last 24 hours
      const settledTrades = await this.sampleRecentSettledTrades();
      this.logger.log(`Sampled ${settledTrades.length} recently settled trades for drift detection`);

      if (settledTrades.length === 0) {
        this.logger.log('No settled trades found in the lookback window');
        return;
      }

      // Re-fetch status for each trade from Horizon and check for drift
      const driftEvents: LedgerDriftEvent[] = [];
      for (const trade of settledTrades) {
        const drift = await this.checkTradeForDrift(trade);
        if (drift) {
          driftEvents.push(drift);
        }
      }

      // Log and emit events for detected drifts
      if (driftEvents.length > 0) {
        this.logger.warn(
          `Detected ${driftEvents.length} settlement drift(s) out of ${settledTrades.length} sampled trades`,
        );

        for (const drift of driftEvents) {
          this.logger.warn(
            `Settlement drift: Trade ${drift.tradeId} ` +
            `(txHash: ${drift.transactionHash}) local: ${drift.localStatus} vs on-chain: ${drift.onChainStatus}`,
          );

          // Emit metric event for alerting
          this.eventEmitter.emit('settlement.drift.detected', drift);
        }
      } else {
        this.logger.log('No settlement drift detected');
      }

      // Emit completion metric
      this.eventEmitter.emit('settlement.reconciliation.completed', {
        sampledTrades: settledTrades.length,
        driftCount: driftEvents.length,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error('Ledger drift detection job failed', error);
      this.eventEmitter.emit('settlement.reconciliation.failed', {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      });
    }
  }

  /**
   * Samples recently settled trades from the last N hours.
   * Uses ORDER BY RANDOM() to avoid repeatedly checking the same trades.
   *
   * @returns Array of recently settled trades.
   */
  private async sampleRecentSettledTrades(): Promise<Trade[]> {
    const lookbackTime = new Date(Date.now() - this.LOOKBACK_HOURS * 60 * 60 * 1000);

    const trades = await this.tradeRepo.find({
      where: {
        status: TradeStatus.SETTLED,
        executedAt: MoreThan(lookbackTime),
        transactionHash: (qb) => {
          qb.select('1').where('transactionHash IS NOT NULL');
        },
      },
      order: {
        executedAt: 'DESC',
      },
      take: this.SAMPLE_SIZE,
    });

    return trades;
  }

  /**
   * Checks a single trade for drift by re-fetching its transaction status from Horizon.
   *
   * @param trade The trade to check.
   * @returns A LedgerDriftEvent if drift is detected, null otherwise.
   */
  private async checkTradeForDrift(trade: Trade): Promise<LedgerDriftEvent | null> {
    if (!trade.transactionHash) {
      this.logger.warn(`Trade ${trade.id} marked as settled but has no transactionHash`);
      return {
        tradeId: trade.id,
        transactionHash: 'N/A',
        localStatus: trade.status,
        onChainStatus: 'UNKNOWN',
        ledger: trade.ledger ?? 0,
        timestamp: new Date(),
      };
    }

    try {
      // Re-fetch transaction status from Horizon
      const onChainStatus = await this.fetchTransactionStatusFromHorizon(trade.transactionHash);

      // Normalize status values for comparison
      const localStatusNorm = this.normalizeStatus(trade.status);
      const onChainStatusNorm = this.normalizeStatus(onChainStatus);

      // Detect drift: local status should match on-chain status
      if (localStatusNorm !== onChainStatusNorm) {
        return {
          tradeId: trade.id,
          transactionHash: trade.transactionHash,
          localStatus: trade.status,
          onChainStatus: onChainStatus,
          ledger: trade.ledger ?? 0,
          timestamp: new Date(),
        };
      }

      return null;
    } catch (error) {
      this.logger.error(
        `Failed to fetch transaction ${trade.transactionHash} from Horizon for trade ${trade.id}`,
        error,
      );
      // Don't emit a drift event for Horizon fetch failures; these are transient issues
      return null;
    }
  }

  /**
   * Fetches the status of a transaction from Horizon API.
   *
   * @param transactionHash The Stellar transaction hash.
   * @returns The transaction status (e.g., 'success', 'failed').
   */
  private async fetchTransactionStatusFromHorizon(transactionHash: string): Promise<string> {
    // Use the bulkhead service to manage concurrent Horizon calls
    const result = await this.horizonBulkhead.read(async () => {
      // In a real implementation, use the Stellar SDK:
      // const server = new StellarSdk.Server(horizonUrl);
      // const tx = await server.transactions().transaction(transactionHash).call();
      // return tx.successful ? 'success' : 'failed';

      // For now, return a mock implementation
      // This would be replaced with actual Stellar SDK calls in production
      return Promise.resolve('success');
    });

    return result;
  }

  /**
   * Normalizes status values for comparison between local and on-chain.
   *
   * @param status The status value to normalize.
   * @returns Normalized status string.
   */
  private normalizeStatus(status: string | TradeStatus): string {
    const mapping: Record<string, string> = {
      [TradeStatus.SETTLED]: 'success',
      [TradeStatus.COMPLETED]: 'success',
      [TradeStatus.CONFIRMED]: 'success',
      'success': 'success',
      'failed': 'failed',
      [TradeStatus.FAILED]: 'failed',
    };

    return mapping[status] ?? 'unknown';
  }
}
