import {
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
  BeforeApplicationShutdown,
  Inject,
  Optional,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

/**
 * A resource that participates in the bounded graceful shutdown sequence.
 *
 * Implementations should stop accepting new work in `stopAcceptingWork` and
 * release their resources in `close`. Both hooks must be idempotent so the
 * shutdown coordinator can safely invoke them exactly once.
 */
export interface ShutdownResource {
  /** Human readable name used in diagnostics. */
  readonly name: string;
  /** Stop accepting new work (e.g. pause queue consumers, stop HTTP listener). */
  stopAcceptingWork?(): Promise<void> | void;
  /** Release the underlying resource (connections, handles, timers). */
  close(): Promise<void> | void;
}

/**
 * Coordinates a bounded, observable, idempotent shutdown for the application.
 *
 * Order of operations:
 *   1. Stop accepting new work (HTTP server + queue consumers).
 *   2. Drain and close resources exactly once.
 *   3. Emit completion or timeout diagnostics.
 *
 * If the configured deadline elapses before shutdown completes, a timeout
 * diagnostic is emitted and the process is force-exited so termination stays
 * bounded.
 */
@Injectable()
export class ShutdownService implements BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownService.name);
  private readonly resources: ShutdownResource[] = [];
  private shuttingDown = false;
  private completed = false;

  constructor(
    @Optional() @Inject(HttpAdapterHost) private readonly httpAdapterHost?: HttpAdapterHost,
  ) {}

  /** Register a resource to be closed during shutdown. */
  register(resource: ShutdownResource): void {
    this.resources.push(resource);
  }

  /** Deadline (ms) allowed for the full shutdown sequence. */
  private get deadlineMs(): number {
    const parsed = Number(process.env.SHUTDOWN_TIMEOUT_MS);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
  }

  /**
   * Phase 1: stop accepting new work before draining in-flight work.
   * Runs before Nest closes providers so consumers stop pulling new jobs.
   */
  async beforeApplicationShutdown(signal?: string): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    this.logger.log(`Shutdown initiated${signal ? ` (signal: ${signal})` : ''}`);

    const httpServer = this.httpAdapterHost?.httpAdapter?.getHttpServer?.();
    if (httpServer && typeof httpServer.close === 'function') {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
      this.logger.log('HTTP server stopped accepting new connections');
    }

    await Promise.all(
      this.resources.map(async (resource) => {
        if (typeof resource.stopAcceptingWork !== 'function') {
          return;
        }
        try {
          await resource.stopAcceptingWork();
          this.logger.log(`Resource "${resource.name}" stopped accepting work`);
        } catch (error) {
          this.logger.error(
            `Resource "${resource.name}" failed to stop accepting work: ${(error as Error).message}`,
          );
        }
      }),
    );
  }

  /**
   * Phase 2: drain and close resources exactly once, bounded by the deadline.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    if (this.completed) {
      return;
    }

    const deadlineMs = this.deadlineMs;
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Shutdown exceeded deadline of ${deadlineMs}ms`));
      }, deadlineMs);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });

    try {
      await Promise.race([this.closeResources(), timeout]);
      this.completed = true;
      this.logger.log(
        `Shutdown completed successfully${signal ? ` (signal: ${signal})` : ''}`,
      );
    } catch (error) {
      this.logger.error(
        `Shutdown timed out or failed after ${deadlineMs}ms: ${(error as Error).message}`,
      );
      // Bounded shutdown: force exit so termination cannot hang indefinitely.
      process.exit(1);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /** Close every registered resource exactly once. */
  private async closeResources(): Promise<void> {
    for (const resource of this.resources) {
      try {
        await resource.close();
        this.logger.log(`Resource "${resource.name}" closed`);
      } catch (error) {
        this.logger.error(
          `Resource "${resource.name}" failed to close: ${(error as Error).message}`,
        );
      }
    }
  }
}

@Module({
  providers: [ShutdownService],
  exports: [ShutdownService],
})
export class ShutdownModule {}
