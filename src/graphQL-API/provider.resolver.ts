import {
  Resolver,
  Query,
  Args,
  ID,
  ResolveField,
  Parent,
  Context,
  Int,
} from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';

import { GqlAuthGuard } from '../guards/gql-auth.guard';
import { ProviderType, ProviderStatsType, PaginatedProvidersType } from '../types/provider.type';
import { SignalType } from '../types/signal.type';
import { PaginationInput } from '../inputs/pagination.input';
import { ProvidersService } from '../../providers/providers.service';
import { DataLoaderSet } from '../utils/dataloader-factory';
import { Public } from '../../common/decorators/public.decorator';

interface GqlContext {
  loaders: DataLoaderSet;
}

@UseGuards(GqlAuthGuard)
@Resolver(() => ProviderType)
export class ProviderResolver {
  private readonly logger = new Logger(ProviderResolver.name);

  constructor(private readonly providersService: ProvidersService) {}

  // ─── Queries ───────────────────────────────────────────────────────────────

  @Public()
  @Query(() => PaginatedProvidersType, {
    description: 'Paginated list of all verified signal providers',
  })
  async providers(
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
    @Args('onlyVerified', { nullable: true, defaultValue: false }) onlyVerified?: boolean,
  ): Promise<PaginatedProvidersType> {
    return this.providersService.findMany({ pagination, onlyVerified });
  }

  @Public()
  @Query(() => ProviderType, { nullable: true, description: 'Fetch a single provider by ID' })
  async provider(@Args('id', { type: () => ID }) id: string): Promise<ProviderType | null> {
    return this.providersService.findById(id);
  }

  @Query(() => [ProviderType], { description: 'Top providers ranked by win rate' })
  async topProviders(
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 10 }) limit?: number,
  ): Promise<ProviderType[]> {
    return this.providersService.findTopByWinRate(limit ?? 10);
  }

  // ─── Field resolvers ───────────────────────────────────────────────────────

  /** Aggregated stats resolved lazily — skipped if client doesn't request the field. */
  @ResolveField(() => ProviderStatsType)
  async stats(@Parent() provider: ProviderType): Promise<ProviderStatsType> {
    return this.providersService.getStats(provider.id);
  }

  /** Recent signals for a provider — batched via DataLoader to avoid N+1. */
  @ResolveField(() => [SignalType], { description: 'Most recent signals from this provider' })
  async recentSignals(
    @Parent() provider: ProviderType,
    @Context() ctx: GqlContext,
  ): Promise<SignalType[]> {
    return ctx.loaders.signalsByProviderId.load(provider.id);
  }
}
