import { Resolver, Query, ResolveField, Parent, Context } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';

import { GqlAuthGuard } from '../guards/gql-auth.guard';
import {
  PortfolioType,
  PortfolioPerformanceType,
  AllocationItemType,
  PositionType,
} from '../types/portfolio.type';
import { AssetMetaType } from '../types/asset.type';
import { PortfolioService } from '../../portfolio/portfolio.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GqlOwnershipGuard } from '../../authorization/guards/gql-ownership.guard';
import { FieldOwner } from '../../authorization/decorators/field-owner.decorator';

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

  // Each field below exposes account-bound data (positions, allocations,
  // performance) keyed off `portfolio.userId`. GqlOwnershipGuard centralizes
  // the "requester owns this account, or is an authorized operator" check so
  // it can't be forgotten or duplicated inconsistently if PortfolioType is
  // ever reachable from a future admin-facing root query.

  @UseGuards(GqlOwnershipGuard)
  @FieldOwner()
  @ResolveField(() => [PositionType])
  async openPositions(@Parent() portfolio: PortfolioType): Promise<PositionType[]> {
    return this.portfolioService.getOpenPositions(portfolio.userId);
  }

  @UseGuards(GqlOwnershipGuard)
  @FieldOwner()
  @ResolveField(() => [AssetMetaType], { nullable: true })
  async assets(
    @Parent() portfolio: PortfolioType,
    @Context() ctx: any,
  ): Promise<AssetMetaType[]> {
    const positions = await this.portfolioService.getOpenPositions(portfolio.userId);
    const codes = positions.map((p: any) => p.assetSymbol?.split('/')[0]).filter(Boolean);
    const assets = await ctx.loaders.assetByCode.loadMany(codes);
    return assets as AssetMetaType[];
  }

  @UseGuards(GqlOwnershipGuard)
  @FieldOwner()
  @ResolveField(() => [AllocationItemType])
  async allocation(@Parent() portfolio: PortfolioType): Promise<AllocationItemType[]> {
    return this.portfolioService.getAllocation(portfolio.userId);
  }

  @UseGuards(GqlOwnershipGuard)
  @FieldOwner()
  @ResolveField(() => PortfolioPerformanceType)
  async performance(@Parent() portfolio: PortfolioType): Promise<PortfolioPerformanceType> {
    return this.portfolioService.getPerformance(portfolio.userId);
  }
}
