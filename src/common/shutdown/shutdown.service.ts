import { Injectable, Logger } from '@nestjs/common';

/**
 * Tracks whether the application has begun graceful shutdown.
 *
 * Set once by the SIGTERM/SIGINT handler in main.ts before any resource
 * (HTTP server, database, cache, queues) is torn down, so that
 * {@link ShutdownGuardMiddleware} can start rejecting new HTTP traffic
 * immediately — independently of how long the orchestrator takes to notice
 * the readiness probe flip and stop routing requests here.
 *
 * Also coordinates a bounded, observable, idempotent shutdown sequence:
 * new work is refused first, registered resources are drained/closed exactly
 * once, and completion or timeout diagnostics are emitted.
 */
@Injectable()
export class ShutdownService {
  private readonly logger = new Logger(ShutdownService.name);
  private shuttingDown = false;
  private signal: string | undefined;
  private readonly hooks: Array<{ name: string; run: () => Promise<void> | void }> = [];
  private shutdownPromise: Promise<void> | undefined;

  beginShutdown(signal?: string): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.signal = signal;
    this.logger.log(`Graceful shutdown initiated${signal ? ` (signal=${signal})` : ''}`);
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  getSignal(): string | undefined {
    return this.signal;
  }

  /**
   * Registers a resource teardown hook (HTTP server, queues, DB connections,
   * scheduled jobs). Hooks run in registration order during {@link shutdown}.
   */
  registerHook(name: string, run: () => Promise<void> | void): void {
    this.hooks.push({ name, run });
  }

  /**
   * Runs the bounded shutdown sequence exactly once. New work must already be
   * refused via {@link beginShutdown}; this drains and closes registered
   * resources, emitting completion or timeout diagnostics.
   */
  shutdown(deadlineMs: number): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.runShutdown(deadlineMs);
    return this.shutdownPromise;
  }

  private async runShutdown(deadlineMs: number): Promise<void> {
    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), deadlineMs);
      if (typeof timer.unref === 'function') timer.unref();
    });

    const drain = (async (): Promise<'done'> => {
      for (const hook of this.hooks) {
        try {
          await hook.run();
        } catch (err) {
          this.logger.error(
            `Shutdown hook "${hook.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return 'done';
    })();

    const outcome = await Promise.race([drain, timeout]);
    if (timer) clearTimeout(timer);

    const elapsed = Date.now() - startedAt;
    if (outcome === 'timeout') {
      this.logger.error(
        `Graceful shutdown timed out after ${elapsed}ms (deadline=${deadlineMs}ms); forcing exit`,
      );
      return;
    }
    this.logger.log(`Graceful shutdown completed in ${elapsed}ms`);
  }
}
