import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Trade, TradeStatus } from '../../trades/entities/trade.entity';
import { POSITION_LIMIT_CONFIG } from './position-limit.config';

export const POSITION_LIMIT_EXCEEDED = 'POSITION_LIMIT_EXCEEDED';

@Injectable()
export class PositionLimitService {
  private readonly logger = new Logger(PositionLimitService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
  ) {}

  /**
   * Resolves open exposure (USD) for a user on a trading pair.
   * Open = PENDING | EXECUTING trades.
   */
  async getOpenExposureUSD(userId: string, pair: string): Promise<number> {
    const [base, counter] = pair.split('/');
    const openTrades = await this.tradeRepository.find({
      where: {
        userId,
        baseAsset: base,
        counterAsset: counter,
        status: In([TradeStatus.PENDING, TradeStatus.EXECUTING]),
      },
    });

    return openTrades.reduce((sum, t) => sum + Number(t.amount) * Number(t.entryPrice), 0);
  }

  /**
   * Throws POSITION_LIMIT_EXCEEDED (422) if adding newOrderUSD would breach
   * the configured per-user, per-pair limit.
   */
  async enforce(userId: string, pair: string, newOrderUSD: number): Promise<void> {
    const currentExposure = await this.getOpenExposureUSD(userId, pair);
    const limit =
      POSITION_LIMIT_CONFIG.perPairOverrides[pair] ??
      POSITION_LIMIT_CONFIG.defaultMaxExposureUSD;

    this.logger.debug(
      `Position limit check: user=${userId} pair=${pair} ` +
        `existing=$${currentExposure.toFixed(2)} new=$${newOrderUSD.toFixed(2)} limit=$${limit}`,
    );

    if (currentExposure + newOrderUSD > limit) {
      const msg =
        `Order rejected: would exceed ${pair} limit of $${limit}. ` +
        `Current exposure: $${currentExposure.toFixed(2)}, ` +
        `order size: $${newOrderUSD.toFixed(2)}`;
      this.logger.warn(`${POSITION_LIMIT_EXCEEDED}: ${msg}`);
      throw Object.assign(new UnprocessableEntityException(msg), {
        code: POSITION_LIMIT_EXCEEDED,
      });
    }
  }
}
