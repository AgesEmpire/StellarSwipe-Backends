import { Injectable, Logger } from '@nestjs/common';
import {
  Bulkhead,
  BulkheadMetrics,
  BulkheadRejectedError,
} from '../stellar/bulkhead/bulkhead';
import { resolveProviderConcurrency } from './provider-concurrency.config';

/**
 * ProviderConcurrencyService
 *
 * Caps simultaneous outbound requests independently for each external
 * provider. Each provider gets its own bulkhead (created lazily from
 * `resolveProviderConcurrency`), so saturation is contained to that provider.
 *
 * Saturation policy: a call runs immediately while a slot is free, otherwise
 * waits FIFO in the provider's bounded queue; once both are full the call
 * fails fast with {@link BulkheadRejectedError} instead of piling up.
 */
@Injectable()
export class ProviderConcurrencyService {
  private readonly logger = new Logger(ProviderConcurrencyService.name);
  private readonly bulkheads = new Map<string, Bulkhead>();

  async execute<T>(provider: string, task: () => Promise<T>): Promise<T> {
    const bulkhead = this.bulkheadFor(provider);
    try {
      return await bulkhead.execute(task);
    } catch (error) {
      if (error instanceof BulkheadRejectedError) {
        const { active, maxConcurrent, queued, maxQueue } =
          bulkhead.getMetrics();
        this.logger.warn(
          `Outbound request to "${provider}" rejected: provider saturated ` +
            `(active=${active}/${maxConcurrent}, queued=${queued}/${maxQueue})`,
        );
      }
      throw error;
    }
  }

  /** Current metrics for every provider that has handled a request. */
  getAllMetrics(): BulkheadMetrics[] {
    return Array.from(this.bulkheads.values()).map((b) => b.getMetrics());
  }

  private bulkheadFor(provider: string): Bulkhead {
    let bulkhead = this.bulkheads.get(provider);
    if (!bulkhead) {
      const { maxConcurrent, maxQueue } = resolveProviderConcurrency(provider);
      bulkhead = new Bulkhead(provider, maxConcurrent, maxQueue);
      this.bulkheads.set(provider, bulkhead);
    }
    return bulkhead;
  }
}
