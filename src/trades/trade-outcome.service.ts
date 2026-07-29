import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade, TradeStatus } from './entities/trade.entity';
import { TradeOutcomeDto } from './dto/trade-outcome.dto';
import { TradeOutcomeQueryDto } from './dto/trade-outcome-query.dto';

const FINAL_STATUSES = new Set([
  TradeStatus.COMPLETED,
  TradeStatus.SETTLED,
  TradeStatus.FAILED,
  TradeStatus.CANCELLED,
]);

@Injectable()
export class TradeOutcomeService {
  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
  ) {}

  async getOutcome(tradeId: string, requestingUserId: string): Promise<TradeOutcomeDto> {
    const trade = await this.tradeRepo.findOne({ where: { id: tradeId } });
    if (!trade) throw new NotFoundException(`Trade ${tradeId} not found`);
    if (trade.userId !== requestingUserId) throw new ForbiddenException('Access denied');
    return this.toOutcomeDto(trade);
  }

  async queryOutcomes(query: TradeOutcomeQueryDto, requestingUserId: string): Promise<TradeOutcomeDto[]> {
    // Enforce: callers can only query their own trades
    const userId = query.userId ?? requestingUserId;
    if (userId !== requestingUserId) throw new ForbiddenException('Access denied');

    const qb = this.tradeRepo.createQueryBuilder('t').where('t.user_id = :userId', { userId });

    if (query.transactionId) {
      qb.andWhere('t.transaction_hash = :txHash', { txHash: query.transactionId });
    }

    if (query.status) {
      qb.andWhere('t.status = :status', { status: query.status });
    }

    qb.orderBy('t.created_at', 'DESC').take(50);

    const trades = await qb.getMany();
    return trades.map((t) => this.toOutcomeDto(t));
  }

  private toOutcomeDto(trade: Trade): TradeOutcomeDto {
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
      transactionHash: trade.transactionHash,
      sorobanContractId: trade.sorobanContractId,
      failureReason: trade.errorMessage,
      executedAt: trade.executedAt,
      closedAt: trade.closedAt,
      createdAt: trade.createdAt,
      isFinal: FINAL_STATUSES.has(trade.status),
    };
  }
}
