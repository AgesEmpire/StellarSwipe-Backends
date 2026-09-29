import { BadRequestException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { Portfolio } from '../entities/portfolio.entity';
import { PortfolioHolding } from '../entities/portfolio-holding.entity';
import { PortfolioAppliedTrade } from '../entities/portfolio-applied-trade.entity';
import { fromUnits, mulDiv, mulUnits, toUnits } from '../utils/fixed-decimal';

const UNIQUE_VIOLATION = '23505';

export interface CreatePortfolioInput {
  eventId: string;
  userId: string;
  baseCurrency: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface ApplyTradeInput {
  tradeId: string;
  fillId?: string;
  userId: string;
  asset: string;
  side: 'BUY' | 'SELL';
  quantity: number | string;
  price: number | string;
  executedAt: Date;
}

export type ApplyTradeResult =
  | { applied: true; holding: PortfolioHolding }
  | { applied: false; reason: 'duplicate' };

export class InsufficientHoldingsException extends UnprocessableEntityException {
  constructor(asset: string, available: string, requested: string) {
    super(`Insufficient ${asset} holdings: available ${available}, requested ${requested}`);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof QueryFailedError && (error as any).driverError?.code === UNIQUE_VIOLATION;
}

/**
 * Persists portfolio lifecycle changes driven by domain events. All writes are
 * idempotent so redelivered or replayed events never double-apply.
 */
@Injectable()
export class PortfolioLifecycleService {
  private readonly logger = new Logger(PortfolioLifecycleService.name);

  constructor(
    @InjectRepository(Portfolio)
    private readonly portfolioRepository: Repository<Portfolio>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Create the user's portfolio exactly once. A duplicate delivery (same
   * event or same user) returns the existing record instead of failing.
   */
  async createPortfolio(input: CreatePortfolioInput): Promise<{ portfolio: Portfolio; created: boolean }> {
    const baseCurrency = input.baseCurrency?.trim().toUpperCase();
    if (!baseCurrency) throw new BadRequestException('baseCurrency is required');

    const existing = await this.findExisting(input);
    if (existing) return { portfolio: existing, created: false };

    try {
      const portfolio = await this.portfolioRepository.save(
        this.portfolioRepository.create({
          userId: input.userId,
          baseCurrency,
          name: input.name ?? null,
          metadata: input.metadata ?? {},
          sourceEventId: input.eventId,
        }),
      );
      return { portfolio, created: true };
    } catch (error) {
      // Concurrent delivery won the race; treat as duplicate.
      if (isUniqueViolation(error)) {
        const winner = await this.findExisting(input);
        if (winner) return { portfolio: winner, created: false };
      }
      throw error;
    }
  }

  private findExisting(input: CreatePortfolioInput): Promise<Portfolio | null> {
    return this.portfolioRepository.findOne({
      where: [{ sourceEventId: input.eventId }, { userId: input.userId }],
    });
  }

  /**
   * Apply a completed trade (or partial fill) to holdings using the
   * average-cost method. Runs in one transaction with the idempotency ledger
   * so a replayed fill is skipped and a failed update leaves no trace.
   */
  async applyTrade(input: ApplyTradeInput): Promise<ApplyTradeResult> {
    const quantity = toUnits(input.quantity);
    const price = toUnits(input.price);
    if (quantity <= 0n) throw new BadRequestException('Trade quantity must be positive');
    if (price <= 0n) throw new BadRequestException('Trade price must be positive');

    const idempotencyKey = `${input.tradeId}:${input.fillId ?? 'full'}`;

    try {
      return await this.dataSource.transaction(async (manager) => {
        await manager.insert(PortfolioAppliedTrade, {
          idempotencyKey,
          tradeId: input.tradeId,
          userId: input.userId,
        });

        const holding = await this.lockHolding(manager, input.userId, input.asset);
        const held = toUnits(holding.quantity);
        const cost = toUnits(holding.costBasis);

        if (input.side === 'BUY') {
          holding.quantity = fromUnits(held + quantity);
          holding.costBasis = fromUnits(cost + mulUnits(quantity, price));
        } else {
          if (quantity > held) {
            throw new InsufficientHoldingsException(input.asset, fromUnits(held), fromUnits(quantity));
          }
          const remaining = held - quantity;
          holding.quantity = fromUnits(remaining);
          holding.costBasis = remaining === 0n ? fromUnits(0n) : fromUnits(cost - mulDiv(cost, quantity, held));
        }

        if (!holding.lastTradeAt || input.executedAt > holding.lastTradeAt) {
          holding.lastTradeAt = input.executedAt;
        }

        return { applied: true as const, holding: await manager.save(holding) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.debug(`Trade ${idempotencyKey} already applied; skipping`);
        return { applied: false, reason: 'duplicate' };
      }
      throw error;
    }
  }

  private async lockHolding(manager: EntityManager, userId: string, asset: string): Promise<PortfolioHolding> {
    const repo = manager.getRepository(PortfolioHolding);
    await repo
      .createQueryBuilder()
      .insert()
      .values({ userId, asset, quantity: '0', costBasis: '0' })
      .orIgnore()
      .execute();
    return repo.findOneOrFail({ where: { userId, asset }, lock: { mode: 'pessimistic_write' } });
  }
}
