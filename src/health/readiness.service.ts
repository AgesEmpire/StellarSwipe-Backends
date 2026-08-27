import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

/**
 * Issue #1038 — Graceful readiness transitions.
 *
 * Tracks application lifecycle so the readiness probe reflects whether the
 * instance is actually ready to serve traffic:
 *
 *   - Starts as NOT ready (false).
 *   - Becomes ready only after markReady() is called (post-migration / post-init).
 *   - Becomes NOT ready again when markNotReady() is called (pre-shutdown drain).
 *   - Distinguishes dependency failure (notReady + reason) from process death (liveness).
 */
@Injectable()
export class ReadinessService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReadinessService.name);
  private ready = false;
  private reason: string | null = 'startup_pending';

  onApplicationBootstrap(): void {
    // Called by NestJS after all modules are initialised.
    // Actual readiness is set by markReady() once migrations/deps are confirmed.
    this.logger.log('Application bootstrapped — awaiting readiness signal');
  }

  onApplicationShutdown(signal?: string): void {
    this.markNotReady(`shutdown_signal:${signal ?? 'unknown'}`);
  }

  /** Call after migrations and critical dependency checks pass. */
  markReady(): void {
    this.ready = true;
    this.reason = null;
    this.logger.log('Readiness: READY');
  }

  /** Call before draining connections on shutdown, or on dependency failure. */
  markNotReady(reason: string): void {
    this.ready = false;
    this.reason = reason;
    this.logger.warn(`Readiness: NOT READY — ${reason}`);
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Returns the reason the service is not ready, or null when ready. */
  getNotReadyReason(): string | null {
    return this.ready ? null : this.reason;
  }
}
