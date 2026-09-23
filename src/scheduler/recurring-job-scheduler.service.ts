import { Injectable, Logger } from '@nestjs/common';

export interface RecurringJobOptions {
  name: string;
  intervalMs: number;
  maxRetries?: number;
  retryDelayMs?: number;
  lockTtlMs?: number;
}

export interface RecurringJobMetrics {
  name: string;
  runs: number;
  failures: number;
  retries: number;
  lastRunAt?: Date;
  lastDurationMs?: number;
  lastError?: string;
}

/**
 * Generic abstraction for recurring backend jobs (cleanup, aggregation, sync, etc.)
 * providing retry-with-backoff, in-process locking, and basic observability.
 *
 * Usage:
 *   scheduler.register({ name: 'cleanup-expired-sessions', intervalMs: 60_000 }, async () => { ... });
 */
@Injectable()
export class RecurringJobScheduler {
  private readonly logger = new Logger(RecurringJobScheduler.name);
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly locks = new Set<string>();
  private readonly metrics = new Map<string, RecurringJobMetrics>();

  register(options: RecurringJobOptions, task: () => Promise<void>): void {
    const { name, intervalMs, maxRetries = 3, retryDelayMs = 1000 } = options;

    if (this.timers.has(name)) {
      throw new Error(`Recurring job "${name}" is already registered`);
    }

    this.metrics.set(name, { name, runs: 0, failures: 0, retries: 0 });

    const timer = setInterval(() => {
      void this.runWithRetry(name, task, maxRetries, retryDelayMs);
    }, intervalMs);

    this.timers.set(name, timer);
    this.logger.log(`Registered recurring job "${name}" every ${intervalMs}ms`);
  }

  unregister(name: string): void {
    const timer = this.timers.get(name);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(name);
      this.logger.log(`Unregistered recurring job "${name}"`);
    }
  }

  getMetrics(name?: string): RecurringJobMetrics[] {
    if (name) {
      const metric = this.metrics.get(name);
      return metric ? [metric] : [];
    }
    return Array.from(this.metrics.values());
  }

  private async runWithRetry(
    name: string,
    task: () => Promise<void>,
    maxRetries: number,
    retryDelayMs: number,
  ): Promise<void> {
    if (this.locks.has(name)) {
      this.logger.warn(`Skipping run for "${name}": previous execution still holds the lock`);
      return;
    }

    this.locks.add(name);
    const metric = this.metrics.get(name);
    const startedAt = Date.now();

    let attempt = 0;
    try {
      while (attempt <= maxRetries) {
        try {
          await task();
          if (metric) {
            metric.runs += 1;
            metric.lastRunAt = new Date();
            metric.lastDurationMs = Date.now() - startedAt;
            metric.lastError = undefined;
          }
          this.logger.log(`Job "${name}" completed in ${Date.now() - startedAt}ms`);
          return;
        } catch (error) {
          attempt += 1;
          if (metric) {
            metric.retries += 1;
          }
          const message = error instanceof Error ? error.message : String(error);
          if (attempt > maxRetries) {
            if (metric) {
              metric.failures += 1;
              metric.lastError = message;
            }
            this.logger.error(`Job "${name}" failed after ${attempt} attempt(s): ${message}`);
            return;
          }
          this.logger.warn(
            `Job "${name}" attempt ${attempt} failed, retrying in ${retryDelayMs}ms: ${message}`,
          );
          await this.sleep(retryDelayMs);
        }
      }
    } finally {
      this.locks.delete(name);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
