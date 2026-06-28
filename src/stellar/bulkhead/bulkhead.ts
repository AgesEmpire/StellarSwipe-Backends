/**
 * Error thrown when a bulkhead is saturated — both its concurrency slots and
 * its waiting queue are full — so the call is shed rather than queued
 * unbounded.
 */
export class BulkheadRejectedError extends Error {
  constructor(public readonly category: string) {
    super(
      `Bulkhead "${category}" is saturated (concurrency + queue limits reached); request rejected`,
    );
    this.name = 'BulkheadRejectedError';
  }
}

/** Point-in-time view of a single bulkhead's state. */
export interface BulkheadMetrics {
  category: string;
  /** Number of tasks currently executing. */
  active: number;
  /** Number of tasks waiting for a free concurrency slot. */
  queued: number;
  /** Maximum concurrent executions allowed. */
  maxConcurrent: number;
  /** Maximum number of tasks allowed to wait in the queue. */
  maxQueue: number;
  /** Total tasks admitted for execution since startup. */
  totalAdmitted: number;
  /** Total tasks rejected due to saturation since startup. */
  totalRejected: number;
}

interface QueuedTask {
  run: () => void;
}

/**
 * A bulkhead provides a bounded concurrency pool with a bounded waiting queue.
 * Each instance isolates one category of work: saturating it can only reject or
 * queue calls within that category and can never starve a sibling bulkhead.
 */
export class Bulkhead {
  private active = 0;
  private readonly queue: QueuedTask[] = [];
  private totalAdmitted = 0;
  private totalRejected = 0;

  constructor(
    public readonly category: string,
    private readonly maxConcurrent: number,
    private readonly maxQueue: number,
  ) {
    if (maxConcurrent < 1) {
      throw new Error(
        `Bulkhead "${category}" maxConcurrent must be >= 1 (got ${maxConcurrent})`,
      );
    }
    if (maxQueue < 0) {
      throw new Error(
        `Bulkhead "${category}" maxQueue must be >= 0 (got ${maxQueue})`,
      );
    }
  }

  /**
   * Run `task` within this bulkhead. Executes immediately if a concurrency slot
   * is free, otherwise waits in the queue. Rejects with
   * {@link BulkheadRejectedError} if both the pool and the queue are full.
   */
  execute<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        this.totalAdmitted++;
        // Defend against synchronous throws inside `task`.
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => this.release());
      };

      if (this.active < this.maxConcurrent) {
        start();
        return;
      }

      if (this.queue.length < this.maxQueue) {
        this.queue.push({ run: start });
        return;
      }

      this.totalRejected++;
      reject(new BulkheadRejectedError(this.category));
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      next.run();
    }
  }

  getMetrics(): BulkheadMetrics {
    return {
      category: this.category,
      active: this.active,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueue: this.maxQueue,
      totalAdmitted: this.totalAdmitted,
      totalRejected: this.totalRejected,
    };
  }
}
