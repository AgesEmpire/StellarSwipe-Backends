import { Resolver, Query, Args, ID, Int } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';

import { GqlAuthGuard } from '../guards/gql-auth.guard';
import { TradeType, PaginatedTradesType, TradeSummaryType } from '../types/trade.type';
import { TradeFilterInput } from '../inputs/trade-filter.input';
import { PaginationInput } from '../inputs/pagination.input';
import { TradesService } from '../../trades/trades.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(GqlAuthGuard)
@Resolver(() => TradeType)
export class TradeResolver {
  private readonly logger = new Logger(TradeResolver.name);

  constructor(private readonly tradesService: TradesService) {}

  // ─── Queries ───────────────────────────────────────────────────────────────

  @Query(() => PaginatedTradesType, {
    description: 'Paginated trade history for the authenticated user',
  })
  async myTrades(
    @CurrentUser() user: { id: string },
    @Args('filter', { nullable: true }) filter?: TradeFilterInput,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<PaginatedTradesType> {
    this.logger.debug(`myTrades — userId: ${user.id}`);
    return this.tradesService.findForUser({ userId: user.id, filter, pagination });
  }

  @Query(() => TradeType, { nullable: true, description: 'Fetch a single trade by ID' })
  async trade(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: { id: string },
  ): Promise<TradeType | null> {
    return this.tradesService.findOneForUser(id, user.id);
  }

  @Query(() => TradeSummaryType, {
    description: 'Aggregated stats for the authenticated user's trades',
  })
  async tradeSummary(
    @CurrentUser() user: { id: string },
    @Args('filter', { nullable: true }) filter?: TradeFilterInput,
  ): Promise<TradeSummaryType> {
    return this.tradesService.getSummary({ userId: user.id, filter });
  }

  @Query(() => [TradeType], {
    description: 'Most recent N closed trades for the authenticated user',
  })
  async recentTrades(
    @CurrentUser() user: { id: string },
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 5 }) limit?: number,
  ): Promise<TradeType[]> {
    return this.tradesService.findRecentClosed(user.id, limit ?? 5);
  }
}
