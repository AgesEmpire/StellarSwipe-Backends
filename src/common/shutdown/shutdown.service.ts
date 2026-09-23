import { Injectable, Logger } from '@nestjs/common';

/**
 * Tracks whether the application has begun graceful shutdown.
 *
 * Set once by the SIGTERM/SIGINT handler in main.ts before any resource
 * (HTTP server, database, cache, queues) is torn down, so that
 * {@link ShutdownGuardMiddleware} can start rejecting new HTTP traffic
 * immediately — independently of how long the orchestrator takes to notice
 * the readiness probe flip and stop routing requests here.
 */
@Injectable()
export class ShutdownService {
  private readonly logger = new Logger(ShutdownService.name);
  private shuttingDown = false;
  private signal: string | undefined;

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
}
