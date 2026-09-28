import { Injectable, Scope, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import DataLoader from 'dataloader';
import { User } from '../users/entities/user.entity';

/**
 * ProvidersDataLoader
 *
 * Batches individual provider (User) lookups triggered by GraphQL field
 * resolvers on the Signal type. Instead of one SQL query per signal (N+1),
 * the loader collects all requested IDs within a single event-loop tick and
 * fires a single  SELECT ... WHERE id IN (...)  query.
 *
 * Scoped per-request (Scope.REQUEST) so each GraphQL request gets its own
 * loader instance — no cross-request cache leakage.
 */
@Injectable({ scope: Scope.REQUEST })
export class ProvidersDataLoader {
  private readonly logger = new Logger(ProvidersDataLoader.name);

  readonly loader: DataLoader<string, User | null>;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    this.loader = new DataLoader<string, User | null>(
      (ids: readonly string[]) => this.batchLoadProviders(ids),
      {
        cache: true,
        maxBatchSize: 100,
      },
    );
  }

  /** Load a single provider by ID; calls are automatically batched. */
  load(providerId: string): Promise<User | null> {
    return this.loader.load(providerId);
  }

  private async batchLoadProviders(
    ids: readonly string[],
  ): Promise<(User | null)[]> {
    this.logger.debug(
      `Batching ${ids.length} provider lookup(s): [${ids.join(', ')}]`,
    );

    const users = await this.userRepository.find({
      where: { id: In([...ids]) },
    });

    const userMap = new Map<string, User>(users.map((u) => [u.id, u]));

    // Must return results in the same order as the input IDs.
    return ids.map((id) => userMap.get(id) ?? null);
  }
}