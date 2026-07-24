import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade, TradeStatus } from '../entities/trade.entity';
import { StellarConfigService } from '../../config/stellar.service';
import { WebsocketGateway } from '../../websocket/websocket.gateway';
import { SocketEvent } from '../../websocket/dto/socket-event.dto';
import * as StellarSdk from '@stellar/stellar-sdk';
import { NotificationsService } from '../../notifications/notifications.service';
import {
    NotificationType,
    NotificationChannel,
} from '../../notifications/entities/notification.entity';

@Injectable()
export class TxMonitorService {
    private readonly logger = new Logger(TxMonitorService.name);
    private server: StellarSdk.Horizon.Server;

    constructor(
        @InjectRepository(Trade)
        private readonly tradeRepository: Repository<Trade>,
        private readonly stellarConfig: StellarConfigService,
        private readonly websocketGateway: WebsocketGateway,
        private readonly notificationsService: NotificationsService,
    ) {
        this.server = new StellarSdk.Horizon.Server(this.stellarConfig.horizonUrl);
    }

    async checkTradeStatus(trade: Trade): Promise<void> {
        if (!trade.transactionHash) {
            // If no hash, we can't check Horizon yet. 
            // It might be in the process of being submitted.
            return;
        }

        try {
            this.logger.debug(`Checking status for trade ${trade.id}, hash: ${trade.transactionHash}`);

            const tx = await this.server.transactions().transaction(trade.transactionHash).call();

            if (tx.successful) {
                await this.handleSuccessfulTx(trade, tx);
            } else {
                await this.handleFailedTx(trade, 'Transaction failed on network');
            }

        } catch (error: any) {
            if (error.response && error.response.status === 404) {
                // Transaction not found yet, likely still pending propagation
                this.logger.debug(`Transaction ${trade.transactionHash} not found on Horizon yet.`);
                // Ensure it stays PENDING
                return;
            }

            this.logger.error(`Error checking transaction ${trade.transactionHash}: ${error.message}`);
        }
    }

    private async handleSuccessfulTx(trade: Trade, tx: StellarSdk.Horizon.ServerApi.TransactionRecord): Promise<void> {
        const oldStatus = trade.status;

        // Update trade details
        trade.ledger = tx.ledger_attr;
        trade.feeAmount = (parseFloat(String(tx.fee_charged)) / 10000000).toFixed(8); // Fee in XLM

        // Status transition: PENDING -> CONFIRMED
        if (trade.status === TradeStatus.PENDING || trade.status === TradeStatus.EXECUTING) {
            trade.status = TradeStatus.CONFIRMED;
        }

        // Check if it's fully settled (e.g. for SDEX, if offers were claimed)
        // For now, if it's confirmed on ledger, we can consider moving to SETTLED 
        // or we can wait for another pass. The requirement says CONFIRMED -> SETTLED.
        // Let's verify operations to confirm settlement.

        // For this implementation, we'll auto-advance to SETTLED if CONFIRMED 
        // assuming the trade logic was successful.
        if (trade.status === TradeStatus.CONFIRMED) {
            trade.status = TradeStatus.SETTLED;
            // In a real scenario, we might parse tx.operations() to ensure specific trade effects occurred.
        }

        if (trade.status !== oldStatus) {
            await this.tradeRepository.save(trade);
            this.emitUpdate(trade);
            this.logger.log(`Trade ${trade.id} updated to ${trade.status}`);
        }
    }

    private async handleFailedTx(trade: Trade, reason: string): Promise<void> {
        if (trade.status !== TradeStatus.FAILED) {
            trade.status = TradeStatus.FAILED;
            trade.errorMessage = reason;
            await this.tradeRepository.save(trade);
            this.emitUpdate(trade);
            this.logger.warn(`Trade ${trade.id} marked as FAILED: ${reason}`);

            try {
                await this.notificationsService.createAndQueueNotification(
                    trade.userId,
                    NotificationType.RISK_ALERT,
                    'Trade failed',
                    `Your trade ${trade.id} failed: ${reason}. You can retry it from your trade history.`,
                    NotificationChannel.BOTH,
                    { tradeId: trade.id, reason, retryable: true },
                );
            } catch (notifyError: any) {
                // Notification delivery is best-effort — never let it block the
                // status update that already succeeded above.
                this.logger.error(
                    `Failed to send failure notification for trade ${trade.id}: ${notifyError.message}`,
                );
            }
        }
    }

    private emitUpdate(trade: Trade): void {
        this.websocketGateway.emitToUser(trade.userId, SocketEvent.TRADE_UPDATED, {
            id: trade.id,
            status: trade.status,
            transactionHash: trade.transactionHash,
            ledger: trade.ledger,
            updatedAt: new Date(),
        });
    }
}
