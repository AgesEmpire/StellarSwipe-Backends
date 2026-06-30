import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bulkhead, BulkheadMetrics, BulkheadRejectedError } from './bulkhead';
import { HorizonCallCategory } from './horizon-bulkhead.types';
import { HorizonBulkheadConfig } from '../../config/schemas/config.interface';

const DEFAULT_BULKHEAD_CONFIG: HorizonBulkheadConfig = {
  read: { maxConcurrent: 20, maxQueue: 100 },
  write: { maxConcurrent: 5, maxQueue: 25 },
};

/**
 * Routes Horizon API calls through per-category bulkheads so that saturation in
 * one category (e.g. a slow signal-feed read storm) cannot exhaust the shared
 * request pool and starve unrelated calls (e.g. trade-execution writes).
 *
 * Pool sizes are externalized via the `stellar.horizonBulkhead` config
 * (STELLAR_HORIZON_{READ,WRITE}_MAX_{CONCURRENT,QUEUE} env vars).
 */
@Injectable()
export class HorizonBulkheadService {
  private readonly logger = new Logger(HorizonBulkheadService.name);
  private readonly bulkheads = new Map<HorizonCallCategory, Bulkhead>();

  constructor(private readonly configService: ConfigService) {
    const config =
      this.configService.get<HorizonBulkheadConfig>('stellar.horizonBulkhead') ??
      DEFAULT_BULKHEAD_CONFIG;

    this.bulkheads.set(
      HorizonCallCategory.READ,
      new Bulkhead(
        HorizonCallCategory.READ,
        config.read.maxConcurrent,
        config.read.maxQueue,
      ),
    );
    this.bulkheads.set(
      HorizonCallCategory.WRITE,
      new Bulkhead(
        HorizonCallCategory.WRITE,
        config.write.maxConcurrent,
        config.write.maxQueue,
      ),
    );

    this.logger.log(
      `Horizon bulkheads initialized: read(${config.read.maxConcurrent}/${config.read.maxQueue}), ` +
        `write(${config.write.maxConcurrent}/${config.write.maxQueue})`,
    );
  }

  /**
   * Execute a Horizon call inside the bulkhead for the given category. If the
   * category is saturated the returned promise rejects with
   * {@link BulkheadRejectedError} without affecting other categories.
   */
  async execute<T>(
    category: HorizonCallCategory,
    task: () => Promise<T>,
  ): Promise<T> {
    const bulkhead = this.bulkheads.get(category);
    if (!bulkhead) {
      // Should never happen — both categories are registered in the ctor.
      throw new Error(`No bulkhead registered for category "${category}"`);
    }

    try {
      return await bulkhead.execute(task);
    } catch (error) {
      if (error instanceof BulkheadRejectedError) {
        const metrics = bulkhead.getMetrics();
        this.logger.warn(
          `Horizon "${category}" bulkhead rejected a call ` +
            `(active=${metrics.active}/${metrics.maxConcurrent}, ` +
            `queued=${metrics.queued}/${metrics.maxQueue}, ` +
            `totalRejected=${metrics.totalRejected})`,
        );
      }
      throw error;
    }
  }

  /** Convenience wrapper for read-category calls. */
  read<T>(task: () => Promise<T>): Promise<T> {
    return this.execute(HorizonCallCategory.READ, task);
  }

  /** Convenience wrapper for write-category calls. */
  write<T>(task: () => Promise<T>): Promise<T> {
    return this.execute(HorizonCallCategory.WRITE, task);
  }

  /** Current metrics for a single category. */
  getMetrics(category: HorizonCallCategory): BulkheadMetrics | undefined {
    return this.bulkheads.get(category)?.getMetrics();
  }

  /** Current metrics for every category (queue depth + rejection counts). */
  getAllMetrics(): BulkheadMetrics[] {
    return Array.from(this.bulkheads.values()).map((b) => b.getMetrics());
  }
}
