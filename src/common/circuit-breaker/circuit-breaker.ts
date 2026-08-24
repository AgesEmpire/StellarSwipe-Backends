import { Logger } from '@nestjs/common';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Failures required to open the circuit */
  failureThreshold?: number;
  /** Successes in half-open required to close */
  successThreshold?: number;
  /** Time to wait before probing again (ms) */
  resetTimeoutMs?: number;
  name?: string;
}

export class CircuitOpenError extends Error {
  readonly code = 'CIRCUIT_OPEN';

  constructor(public readonly circuitName: string) {
    super(`Circuit breaker open: ${circuitName}`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Lightweight circuit breaker for Stellar / Horizon provider calls (issue #1033).
 *
 * States: closed → open (after failureThreshold) → half-open (after resetTimeout)
 * → closed (after successThreshold) or back to open on failure.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private openedAt = 0;
  private readonly logger: Logger;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly name: string;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.successThreshold = opts.successThreshold ?? 2;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000;
    this.name = opts.name ?? 'default';
    this.logger = new Logger(`CircuitBreaker:${this.name}`);
  }

  getState(): CircuitState {
    if (
      this.state === 'open' &&
      Date.now() - this.openedAt >= this.resetTimeoutMs
    ) {
      this.state = 'half-open';
      this.successes = 0;
      this.logger.log('Transition → half-open (probe)');
    }
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();

    if (state === 'open') {
      throw new CircuitOpenError(this.name);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successes += 1;
      if (this.successes >= this.successThreshold) {
        this.state = 'closed';
        this.failures = 0;
        this.logger.log('Transition → closed (recovered)');
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures += 1;
    if (
      this.state === 'half-open' ||
      this.failures >= this.failureThreshold
    ) {
      this.state = 'open';
      this.openedAt = Date.now();
      this.logger.warn(
        `Transition → open (failures=${this.failures}, threshold=${this.failureThreshold})`,
      );
    }
  }

  /** Metrics-friendly snapshot. */
  snapshot(): {
    name: string;
    state: CircuitState;
    failures: number;
    successes: number;
  } {
    return {
      name: this.name,
      state: this.getState(),
      failures: this.failures,
      successes: this.successes,
    };
  }
}
