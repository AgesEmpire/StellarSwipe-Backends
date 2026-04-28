import { Resolver, Query, ResolveField, Parent } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';

import { GqlAuthGuard } from '../guards/gql-auth.guard';
import {
  PortfolioType,
  PortfolioPerformanceType,
  AllocationItemType,
  PositionType,
} from '../types/portfolio.type';
import { PortfolioService } from '../../portfolio/portfolio.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(GqlAuthGuard)
@Resolver(() => PortfolioType)
export class PortfolioResolver {
  private readonly logger = new Logger(PortfolioResolver.name);

  constructor(private readonly portfolioService: PortfolioService) {}

  // ─── Queries ───────────────────────────────────────────────────────────────

  @Query(() => PortfolioType, {
    nullable: true,
    description: 'Portfolio snapshot for the authenticated user',
  })
  async myPortfolio(@CurrentUser() user: { id: string }): Promise<PortfolioType | null> {
    this.logger.debug(`myPortfolio — userId: ${user.id}`);
    return this.portfolioService.getForUser(user.id);
  }

  // ─── Field resolvers ───────────────────────────────────────────────────────
  // These are resolved lazily — clients only pay the cost if they select the field.

  @ResolveField(() => [PositionType])
  async openPositions(@Parent() portfolio: PortfolioType): Promise<PositionType[]> {
    return this.portfolioService.getOpenPositions(portfolio.userId);
  }

  @ResolveField(() => [AllocationItemType])
  async allocation(@Parent() portfolio: PortfolioType): Promise<AllocationItemType[]> {
    return this.portfolioService.getAllocation(portfolio.userId);
  }

  @ResolveField(() => PortfolioPerformanceType)
  async performance(@Parent() portfolio: PortfolioType): Promise<PortfolioPerformanceType> {
    return this.portfolioService.getPerformance(portfolio.userId);
  }
}
