import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { Trade, TradeStatus } from '../entities/trade.entity';
import { StellarConfigService } from '../../config/stellar.service';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationChannel } from '../../notifications/entities/notification.entity';

export interface PollResult {
  status: 'confirmed' | 'failed' | 'timeout';
  failureReason?: string;
}

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 20; // 20 × 3 s = 60 s max

@Injectable()
export class ConfirmationPollingService {
  private readonly logger = new Logger(ConfirmationPollingService.name);
  private readonly server: SorobanRpc.Server;

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    private readonly stellarConfig: StellarConfigService,
    private readonly notificationService: NotificationService,
  ) {
    this.server = new SorobanRpc.Server(this.stellarConfig.sorobanRpcUrl);
  }

  /**
   * Poll a Soroban transaction until it settles or times out.
   * Updates the trade record and emits a notification on completion.
   */
  async pollUntilSettled(tradeId: string, txHash: string): Promise<PollResult> {
    const trade = await this.tradeRepo.findOne({ where: { id: tradeId } });
    if (!trade) {
      this.logger.warn(`pollUntilSettled: trade ${tradeId} not found`);
      return { status: 'failed', failureReason: 'Trade not found' };
    }

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await this.delay(POLL_INTERVAL_MS * Math.min(attempt + 1, 4)); // back-off cap at 4×

      try {
        const response = await this.server.getTransaction(txHash);

        if (response.status === 'SUCCESS') {
          return await this.handleConfirmed(trade, txHash);
        }

        if (response.status === 'FAILED') {
          const reason =
            (response as any).resultXdr?.toString() ?? 'Transaction failed on-chain';
          return await this.handleFailed(trade, reason);
        }

        // status === 'NOT_FOUND' | 'PENDING' — keep polling
        this.logger.debug(
          `Trade ${tradeId} tx ${txHash} status=${response.status} attempt=${attempt + 1}`,
        );
      } catch (err) {
        this.logger.warn(
          `Poll attempt ${attempt + 1} error for ${txHash}: ${(err as Error).message}`,
        );
      }
    }

    return await this.handleTimeout(trade, txHash);
  }

  // ---------------------------------------------------------------------------

  private async handleConfirmed(trade: Trade, txHash: string): Promise<PollResult> {
    trade.status = TradeStatus.CONFIRMED;
    trade.transactionHash = txHash;
    trade.executedAt = trade.executedAt ?? new Date();
    await this.tradeRepo.save(trade);

    await this.notify(trade, 'Trade Confirmed', `Your trade has been confirmed on-chain.`);
    this.logger.log(`Trade ${trade.id} confirmed — hash ${txHash}`);
    return { status: 'confirmed' };
  }

  private async handleFailed(trade: Trade, reason: string): Promise<PollResult> {
    trade.status = TradeStatus.FAILED;
    trade.errorMessage = reason;
    await this.tradeRepo.save(trade);

    await this.notify(trade, 'Trade Failed', `Your trade failed: ${reason}`);
    this.logger.warn(`Trade ${trade.id} failed — ${reason}`);
    return { status: 'failed', failureReason: reason };
  }

  private async handleTimeout(trade: Trade, txHash: string): Promise<PollResult> {
    const reason = `Confirmation timed out after ${MAX_POLL_ATTEMPTS} attempts`;
    trade.status = TradeStatus.FAILED;
    trade.errorMessage = reason;
    await this.tradeRepo.save(trade);

    await this.notify(trade, 'Trade Confirmation Timeout', reason);
    this.logger.error(`Trade ${trade.id} timed out waiting for ${txHash}`);
    return { status: 'timeout', failureReason: reason };
  }

  private async notify(trade: Trade, title: string, message: string): Promise<void> {
    try {
      await this.notificationService.send({
        userId: trade.userId,
        type: 'TRADE_CONFIRMATION',
        title,
        message,
        channel: NotificationChannel.IN_APP,
        metadata: { tradeId: trade.id, status: trade.status },
      });
    } catch (err) {
      this.logger.warn(`Notification failed for trade ${trade.id}: ${(err as Error).message}`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
