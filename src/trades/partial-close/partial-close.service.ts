import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { PositionLifecycleService } from '../position-lifecycle/position-lifecycle.service';
import {
    PositionLifecycleEventType,
    PositionLifecycleSource,
} from '../position-lifecycle/position-lifecycle-event.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade, TradeStatus, TradeSide } from '../entities/trade.entity';
import { PartialCloseDto } from './dto/partial-close.dto';
import { RiskManagerService } from '../services/risk-manager.service';
import { TradeExecutorService } from '../services/trade-executor.service';

@Injectable()
export class PartialCloseService {
    private readonly logger = new Logger(PartialCloseService.name);

    constructor(
        @InjectRepository(Trade)
        private readonly tradeRepository: Repository<Trade>,
        private readonly riskManager: RiskManagerService,
        private readonly tradeExecutor: TradeExecutorService,
        @Optional()
        private readonly positionLifecycle?: PositionLifecycleService,
    ) { }

    async closePartial(dto: PartialCloseDto): Promise<any> {
        const { tradeId, userId, amount, percentage, exitPrice: providedExitPrice } = dto;

        const originalTrade = await this.tradeRepository.findOne({
            where: { id: tradeId, userId },
        });

        if (!originalTrade) {
            throw new NotFoundException('Trade not found');
        }

        if (originalTrade.status !== TradeStatus.COMPLETED || originalTrade.closedAt) {
            throw new BadRequestException('Trade must be completed and not fully closed to perform a partial close');
        }

        const currentAmount = parseFloat(originalTrade.amount);
        let amountToClose: number;

        if (percentage) {
            amountToClose = (currentAmount * percentage) / 100;
        } else if (amount) {
            amountToClose = amount;
        } else {
            throw new BadRequestException('Either amount or percentage must be provided');
        }

        if (amountToClose >= currentAmount) {
            throw new BadRequestException('Partial close amount must be less than the current position size. Use close trade instead for full closure.');
        }

        // Get market price if exit price not provided
        const exitPrice = providedExitPrice?.toString() || await this.getCurrentPrice();

        // 1. Calculate realized P&L for the closed portion
        const { profitLoss, profitLossPercentage } = this.riskManager.calculateProfitLoss(
            originalTrade.entryPrice,
            exitPrice,
            amountToClose.toString(),
            originalTrade.side === TradeSide.BUY ? 'buy' : 'sell',
        );

        // 2. Execute partial close on Soroban
        const closeResult = await this.tradeExecutor.closeTrade(originalTrade, exitPrice, amountToClose.toString());

        if (!closeResult.success) {
            throw new BadRequestException(`Failed to execute partial close on-chain: ${closeResult.error}`);
        }

        // 3. Create a new "Closed" trade record for the partial closure ( realize the P&L)
        const partialCloseTrade = this.tradeRepository.create({
            ...originalTrade,
            id: undefined, // Let DB generate new ID
            amount: amountToClose.toFixed(8),
            totalValue: (amountToClose * parseFloat(originalTrade.entryPrice)).toFixed(8),
            exitPrice,
            profitLoss,
            profitLossPercentage,
            closedAt: new Date(),
            parentTradeId: originalTrade.id,
            transactionHash: closeResult.transactionHash,
            status: TradeStatus.COMPLETED,
        });

        // 4. Update the original trade (remaining position)
        const remainingAmount = currentAmount - amountToClose;
        if (!originalTrade.originalAmount) {
            originalTrade.originalAmount = originalTrade.amount;
        }
        originalTrade.amount = remainingAmount.toFixed(8);
        originalTrade.totalValue = (remainingAmount * parseFloat(originalTrade.entryPrice)).toFixed(8);

        await this.tradeRepository.save(partialCloseTrade);
        await this.tradeRepository.save(originalTrade);

        // #1534 — partial-close timestamp; quantity semantics are unchanged
        // (the before/after amounts are recorded only as a snapshot).
        await this.positionLifecycle?.recordTransitionSafe({
            positionId: originalTrade.id,
            userId: originalTrade.userId,
            type: PositionLifecycleEventType.PARTIALLY_CLOSED,
            occurredAt: partialCloseTrade.closedAt,
            quantityBefore: currentAmount.toFixed(8),
            quantityAfter: originalTrade.amount,
            source: PositionLifecycleSource.TRADE,
            idempotencyKey: `trade:${originalTrade.id}:partial:${partialCloseTrade.id}`,
            backfill: { openedAt: originalTrade.executedAt ?? originalTrade.createdAt },
            metadata: { closeTradeId: partialCloseTrade.id },
        });

        this.logger.log(`Partial close successful for trade ${originalTrade.id}. Closed ${amountToClose} ${originalTrade.baseAsset}. Remaining: ${remainingAmount}`);

        return {
            success: true,
            closedTradeId: partialCloseTrade.id,
            remainingAmount: originalTrade.amount,
            realizedProfitLoss: profitLoss,
        };
    }

    // Mock for now, similar to TradesService
    private async getCurrentPrice(): Promise<string> {
        return '0.16000000';
    }
}
