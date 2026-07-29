import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class QueueHealthIndicator extends HealthIndicator {
  constructor(
    @InjectQueue('priority-queue')
    private readonly queue: Queue,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      const [counts, isPaused] = await Promise.all([
        this.queue.getJobCounts(),
        this.queue.isPaused(),
      ]);
      const latency = Date.now() - startTime;

      return this.getStatus(key, true, {
        waiting: counts.waiting,
        active: counts.active,
        completed: counts.completed,
        failed: counts.failed,
        delayed: counts.delayed,
        paused: isPaused,
        latency: `${latency}ms`,
      });
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      throw new HealthCheckError(
        'Queue check failed',
        this.getStatus(key, false, {
          error: errorMessage,
          latency: `${latency}ms`,
        }),
      );
    }
  }
}
