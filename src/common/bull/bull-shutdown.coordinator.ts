import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Worker } from 'bullmq';
import { PrometheusService } from '../../monitoring/metrics/prometheus.service';

export interface ShutdownWorker {
  name: string;
  getWorker: () => Pick<Worker, 'pause' | 'close'>;
}

@Injectable()
export class BullShutdownCoordinator implements OnApplicationShutdown {
  private readonly logger = new Logger(BullShutdownCoordinator.name);
  private readonly workers = new Map<string, ShutdownWorker>();
  private readonly gracePeriodMs: number;
  private shuttingDown = false;

  constructor(private readonly prometheus: PrometheusService) {
    const configured = Number(process.env.BULL_SHUTDOWN_GRACE_PERIOD_MS ?? 30000);
    this.gracePeriodMs = Number.isFinite(configured) && configured >= 0 ? configured : 30000;
  }

  register(name: string, worker: Pick<Worker, 'pause' | 'close'> | (() => Pick<Worker, 'pause' | 'close'>)): void {
    this.workers.set(name, {
      name,
      getWorker: typeof worker === 'function' ? worker as () => Pick<Worker, 'pause' | 'close'> : () => worker,
    });
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const workers = [...this.workers.values()].map(({ name, getWorker }) => ({ name, worker: getWorker() }));

    this.logger.log(`BullMQ shutdown started (${workers.length} workers, signal=${signal ?? 'unknown'})`);
    await Promise.all(workers.map(({ worker }) => worker.pause(true)));

    const closePromise = Promise.all(workers.map(({ worker }) => worker.close(false))).then(() => false);
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), this.gracePeriodMs);
    });
    try {
      const forced = await Promise.race([closePromise, timeoutPromise]);
      if (forced) {
        const forcedWorkers = workers.filter(({ worker }) => !this.isClosed(worker));
        this.prometheus.bullShutdownForcedTotal.inc();
        this.logger.error(`BullMQ shutdown grace period exceeded; force-closing ${forcedWorkers.length} workers`);
        await Promise.allSettled(forcedWorkers.map(({ worker }) => worker.close(true)));
      }
      this.logger.log(`BullMQ shutdown completed${forced ? ' with forced interruptions' : ''}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private isClosed(worker: Pick<Worker, 'pause' | 'close'>): boolean {
    return (worker as Worker).closed === true;
  }
}
