import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProviderEarning } from './provider-earning.entity';
import { Payout, PayoutStatus } from './payout.entity';
import {
  EarningRecordDto,
  EarningsSummaryDto,
  PayoutHistoryItemDto,
} from './earnings-summary.dto';

export const PROVIDER_FEE_RATE = 0.001; // 0.1%
export const MINIMUM_PAYOUT_THRESHOLD = 10; // $10 USD equivalent
export const RECENT_EARNINGS_LIMIT = 20;

export interface RecordEarningInput {
  providerId: string;
  signalId: string;
  tradeId: string;
  tradedAmount: number;
  asset: string;
  copierId: string;
}

@Injectable()
export class ProviderRewardsService {
  private readonly logger = new Logger(ProviderRewardsService.name);

  constructor(
    @InjectRepository(ProviderEarning)
    private readonly earningRepository: Repository<ProviderEarning>,
    @InjectRepository(Payout)
    private readonly payoutRepository: Repository<Payout>,
  ) {}

  /**
   * Records a provider earning triggered by a trade execution.
   * earning = tradedAmount * 0.001 (0.1% fee)
   * Idempotent: skips if a record for tradeId already exists.
   */
  async recordEarning(input: RecordEarningInput): Promise<ProviderEarning> {
    const existing = await this.earningRepository.findOne({
      where: { tradeId: input.tradeId },
    });

    if (existing) {
      this.logger.warn(
        `Earning already recorded for tradeId=${input.tradeId}, skipping.`,
      );
      return existing;
    }

    const amount = parseFloat(
      (input.tradedAmount * PROVIDER_FEE_RATE).toFixed(8),
    );

    const earning = this.earningRepository.create({
      providerId: input.providerId,
      signalId: input.signalId,
      tradeId: input.tradeId,
      tradedAmount: input.tradedAmount,
      amount,
      asset: input.asset,
      copierId: input.copierId,
    });

    const saved = await this.earningRepository.save(earning);
    this.logger.log(
      `Recorded earning providerId=${input.providerId} amount=${amount} ${input.asset} for tradeId=${input.tradeId}`,
    );
    return saved;
  }

  /**
   * Returns the aggregated earnings summary for a provider.
   */
  async getEarningsSummary(providerId: string): Promise<EarningsSummaryDto> {
    const [totalEarningsResult, completedPayoutsResult, recentEarnings, totalTransactions] =
      await Promise.all([
        this.earningRepository
          .createQueryBuilder('e')
          .select('SUM(e.amount)', 'total')
          .where('e.providerId = :providerId', { providerId })
          .getRawOne<{ total: string | null }>(),

        this.payoutRepository
          .createQueryBuilder('p')
          .select('SUM(p.amount)', 'total')
          .where('p.providerId = :providerId', { providerId })
          .andWhere('p.status = :status', { status: PayoutStatus.COMPLETED })
          .getRawOne<{ total: string | null }>(),

        this.earningRepository.find({
          where: { providerId },
          order: { createdAt: 'DESC' },
          take: RECENT_EARNINGS_LIMIT,
        }),

        this.earningRepository.count({ where: { providerId } }),
      ]);

    const totalEarnings = parseFloat(totalEarningsResult?.total ?? '0');
    const totalPaidOut = parseFloat(completedPayoutsResult?.total ?? '0');
    const availableBalance = parseFloat(
      (totalEarnings - totalPaidOut).toFixed(8),
    );

    return {
      providerId,
      totalEarnings,
      availableBalance,
      totalPaidOut,
      minimumPayoutThreshold: MINIMUM_PAYOUT_THRESHOLD,
      isEligibleForPayout: availableBalance >= MINIMUM_PAYOUT_THRESHOLD,
      totalTransactions,
      recentEarnings: recentEarnings.map(this.mapToEarningDto),
    };
  }

  /**
   * Returns available balance for a provider (total earnings - completed payouts).
   * Includes PENDING and PROCESSING payouts to prevent double-spend.
   */
  async getAvailableBalance(providerId: string): Promise<number> {
    const [earningsResult, reservedResult] = await Promise.all([
      this.earningRepository
        .createQueryBuilder('e')
        .select('SUM(e.amount)', 'total')
        .where('e.providerId = :providerId', { providerId })
        .getRawOne<{ total: string | null }>(),

      this.payoutRepository
        .createQueryBuilder('p')
        .select('SUM(p.amount)', 'total')
        .where('p.providerId = :providerId', { providerId })
        .andWhere('p.status IN (:...statuses)', {
          statuses: [
            PayoutStatus.PENDING,
            PayoutStatus.PROCESSING,
            PayoutStatus.COMPLETED,
          ],
        })
        .getRawOne<{ total: string | null }>(),
    ]);

    const totalEarnings = parseFloat(earningsResult?.total ?? '0');
    const reserved = parseFloat(reservedResult?.total ?? '0');
    return parseFloat((totalEarnings - reserved).toFixed(8));
  }

  /**
   * Returns payout history for a provider.
   */
  async getPayoutHistory(providerId: string): Promise<PayoutHistoryItemDto[]> {
    const payouts = await this.payoutRepository.find({
      where: { providerId },
      order: { createdAt: 'DESC' },
    });

    return payouts.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      asset: p.asset,
      status: p.status,
      destinationAddress: p.destinationAddress,
      stellarTransactionId: p.stellarTransactionId,
      failureReason: p.failureReason,
      createdAt: p.createdAt,
      processedAt: p.processedAt,
    }));
  }

  /**
   * Returns all earnings records for a provider (paginated).
   */
  async getEarnings(
    providerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: EarningRecordDto[]; total: number }> {
    const [data, total] = await this.earningRepository.findAndCount({
      where: { providerId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data: data.map(this.mapToEarningDto), total };
  }

  private mapToEarningDto(e: ProviderEarning): EarningRecordDto {
    return {
      id: e.id,
      providerId: e.providerId,
      signalId: e.signalId,
      tradeId: e.tradeId,
      amount: Number(e.amount),
      asset: e.asset,
      tradedAmount: Number(e.tradedAmount),
      copierId: e.copierId,
      createdAt: e.createdAt,
    };
  }
}
