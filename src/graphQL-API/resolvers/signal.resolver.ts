import {
  Resolver,
  Query,
  Args,
  ID,
  ResolveField,
  Parent,
  Context,
} from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';

import { GqlAuthGuard } from '../guards/gql-auth.guard';
import { SignalType, PaginatedSignalsType, ProviderType } from '../types/signal.type';
import { SignalFilterInput } from '../inputs/signal-filter.input';
import { PaginationInput } from '../inputs/pagination.input';
import { SignalsService } from '../../signals/signals.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DataLoaderSet } from '../utils/dataloader-factory';

interface GqlContext {
  loaders: DataLoaderSet;
}

@UseGuards(GqlAuthGuard)
@Resolver(() => SignalType)
export class SignalResolver {
  private readonly logger = new Logger(SignalResolver.name);

  constructor(private readonly signalsService: SignalsService) {}

  // ─── Queries ───────────────────────────────────────────────────────────────

  @Query(() => PaginatedSignalsType, {
    description: 'Paginated list of signals with optional filters',
  })
  async signals(
    @Args('filter', { nullable: true }) filter?: SignalFilterInput,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<PaginatedSignalsType> {
    this.logger.debug(`signals query — filter: ${JSON.stringify(filter)}`);
    return this.signalsService.findMany({ filter, pagination });
  }

  @Query(() => SignalType, { nullable: true, description: 'Fetch a single signal by ID' })
  async signal(@Args('id', { type: () => ID }) id: string): Promise<SignalType | null> {
    return this.signalsService.findById(id);
  }

  @Query(() => [SignalType], {
    description: 'Latest active signals across all or one provider',
  })
  async latestSignals(
    @Args('providerId', { type: () => ID, nullable: true }) providerId?: string,
    @Args('limit', { type: () => Number, nullable: true, defaultValue: 10 }) limit?: number,
  ): Promise<SignalType[]> {
    return this.signalsService.findLatestActive({ providerId, limit });
  }

  @Query(() => [SignalType], { description: 'Active signals for the authenticated user' })
  async myActiveSignals(@CurrentUser() user: { id: string }): Promise<SignalType[]> {
    return this.signalsService.findActiveForUser(user.id);
  }

  // ─── Field resolvers ───────────────────────────────────────────────────────

  /**
   * Resolved via DataLoader to prevent N+1 — one DB call for all providers
   * referenced by signals in the current response batch.
   */
  @ResolveField(() => ProviderType, { nullable: true })
  async provider(
    @Parent() signal: SignalType,
    @Context() ctx: GqlContext,
  ): Promise<ProviderType | null> {
    if (!signal.providerId) return null;
    return ctx.loaders.providerById.load(signal.providerId);
  }
}
