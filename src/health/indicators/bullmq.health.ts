import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { Queue } from 'bullmq';
import { Inject, Optional } from '@nestjs/common';

export interface BullMQQueueConfig {
  queue: Queue;
  name: string;
  backlogThreshold: number;
  sustainMs: number;
}

@Injectable()
export class BullMQHealthIndicator extends HealthIndicator {
  private backlogExceedSince: Map<string, number> = new Map();

  constructor(
    @Optional()
    @Inject('BULLMQ_QUEUES')
    private readonly queueConfigs?: BullMQQueueConfig[],
  ) {
    super();
  }

  async isHealthy(key: string = 'bullmq'): Promise<HealthIndicatorResult> {
    if (!this.queueConfigs || this.queueConfigs.length === 0) {
      return this.getStatus(key, true, {
        message: 'No BullMQ queues configured',
        queues: {},
      });
    }

    const startTime = Date.now();
    const queueStatuses: Record<string, any> = {};
    let isHealthy = true;

    try {
      const results = await Promise.allSettled(
        this.queueConfigs.map((config) => this.checkQueue(config)),
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const config = this.queueConfigs[i];

        if (result.status === 'fulfilled') {
          queueStatuses[config.name] = result.value;
          if (!result.value.healthy) {
            isHealthy = false;
          }
        } else {
          isHealthy = false;
          queueStatuses[config.name] = {
            healthy: false,
            error: result.reason.message,
          };
        }
      }

      const latency = Date.now() - startTime;

      return this.getStatus(key, isHealthy, {
        queues: queueStatuses,
        latency: `${latency}ms`,
      });
    } catch (error) {
      const latency = Date.now() - startTime;
      throw new HealthCheckError(
        'BullMQ queue check failed',
        this.getStatus(key, false, {
          error: error instanceof Error ? error.message : 'Unknown error',
          latency: `${latency}ms`,
        }),
      );
    }
  }

  private async checkQueue(
    config: BullMQQueueConfig,
  ): Promise<{
    healthy: boolean;
    waiting: number;
    delayed: number;
    backlog: number;
    threshold: number;
    exceedsThreshold: boolean;
    sustainMs: number;
  }> {
    const counts = await config.queue.getJobCounts(
      'wait',
      'delayed',
      'active',
      'completed',
      'failed',
    );

    const backlog = counts.wait + counts.delayed;
    const exceedsThreshold = backlog > config.backlogThreshold;
    const now = Date.now();
    const lastExceedTime = this.backlogExceedSince.get(config.name);

    if (exceedsThreshold) {
      if (!lastExceedTime) {
        this.backlogExceedSince.set(config.name, now);
      }
    } else {
      this.backlogExceedSince.delete(config.name);
    }

    const exceedDuration = lastExceedTime ? now - lastExceedTime : 0;
    const isUnhealthyDueToBacklog = exceedsThreshold && exceedDuration >= config.sustainMs;

    return {
      healthy: !isUnhealthyDueToBacklog,
      waiting: counts.wait,
      delayed: counts.delayed,
      backlog,
      threshold: config.backlogThreshold,
      exceedsThreshold,
      sustainMs: config.sustainMs,
    };
  }
}
