import { Injectable, Scope } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as DataLoader from 'dataloader';
import { User } from '../../users/entities/user.entity';
import { Signal } from '../../signals/entities/signal.entity';

/**
 * Request-scoped DataLoader service.
 *
 * Each HTTP request gets its own instance (Scope.REQUEST), so batched
 * caches never bleed across requests or tenants.
 *
 * Resolvers/services that previously issued one query per trade to load
 * the related user or signal now call:
 *   this.dataLoaderService.userLoader.load(userId)
 *   this.dataLoaderService.signalLoader.load(signalId)
 *
 * DataLoader coalesces all .load() calls made within the same tick into a
 * single IN (...) query, then distributes results back to each caller.
 */
@Injectable({ scope: Scope.REQUEST })
export class DataLoaderService {
  readonly userLoader: DataLoader<string, User | null>;
  readonly signalLoader: DataLoader<string, Signal | null>;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Signal)
    private readonly signalRepository: Repository<Signal>,
  ) {
    this.userLoader = new DataLoader<string, User | null>(
      (ids) => this.batchLoadUsers(ids as string[]),
      { cache: true },
    );

    this.signalLoader = new DataLoader<string, Signal | null>(
      (ids) => this.batchLoadSignals(ids as string[]),
      { cache: true },
    );
  }

  private async batchLoadUsers(ids: string[]): Promise<(User | null)[]> {
    const users = await this.userRepository.findBy({ id: In(ids) });
    const map = new Map(users.map((u) => [u.id, u]));
    return ids.map((id) => map.get(id) ?? null);
  }

  private async batchLoadSignals(ids: string[]): Promise<(Signal | null)[]> {
    const signals = await this.signalRepository.findBy({ id: In(ids) });
    const map = new Map(signals.map((s) => [s.id, s]));
    return ids.map((id) => map.get(id) ?? null);
  }
}
