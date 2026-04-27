import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export enum CircuitState {
  CLOSED = 'CLOSED',   // Normal operation
  OPEN = 'OPEN',       // Failing — reject requests immediately
  HALF_OPEN = 'HALF_OPEN', // Testing recovery
}

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Milliseconds to wait before transitioning OPEN → HALF_OPEN. Default: 30_000 */
  recoveryTimeMs?: number;
  /** Number of successful probes in HALF_OPEN before closing. Default: 2 */
  successThreshold?: number;
}

interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt?: Date;
  openedAt?: Date;
}

/**
 * CircuitBreakerService
 *
 * Implements the circuit-breaker pattern to prevent cascading failures when
 * external services (Stellar network, payment providers, etc.) are degraded.
 *
 * States:
 *  CLOSED     → normal; failures are counted
 *  OPEN       → requests rejected immediately with ServiceUnavailableException
 *  HALF_OPEN  → one probe request allowed; success closes, failure re-opens
 *
 * Usage:
 *   const result = await this.circuitBreaker.execute('stellar-horizon', () =>
 *     this.httpRetry.get('https://horizon.stellar.org/accounts/...'),
 *   );
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly circuits = new Map<string, CircuitStats>();

  private readonly defaults: Required<CircuitBreakerOptions> = {
    failureThreshold: 5,
    recoveryTimeMs: 30_000,
    successThreshold: 2,
  };

  /**
   * Execute `fn` through the named circuit breaker.
   * Throws ServiceUnavailableException when the circuit is OPEN.
   */
  async execute<T>(
    name: string,
    fn: () => Promise<T>,
    options?: CircuitBreakerOptions,
    fallback?: () => T | Promise<T>,
  ): Promise<T> {
    const opts = { ...this.defaults, ...options };
    const circuit = this.getOrCreate(name);

    if (circuit.state === CircuitState.OPEN) {
      if (this.shouldAttemptRecovery(circuit, opts)) {
        circuit.state = CircuitState.HALF_OPEN;
        this.logger.log(`[CircuitBreaker] "${name}" → HALF_OPEN (probing)`);
      } else {
        this.logger.warn(`[CircuitBreaker] "${name}" is OPEN — rejecting request`);
        if (fallback) return fallback();
        throw new ServiceUnavailableException(
          `Service "${name}" is temporarily unavailable. Please try again later.`,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess(name, circuit, opts);
      return result;
    } catch (error) {
      this.onFailure(name, circuit, opts);
      if (fallback) return fallback();
      throw error;
    }
  }

  /** Get the current state of a named circuit. */
  getState(name: string): CircuitState {
    return this.circuits.get(name)?.state ?? CircuitState.CLOSED;
  }

  /** Get stats for all circuits (useful for health checks). */
  getAllStats(): Record<string, CircuitStats> {
    const result: Record<string, CircuitStats> = {};
    this.circuits.forEach((stats, name) => {
      result[name] = { ...stats };
    });
    return result;
  }

  /** Manually reset a circuit to CLOSED (admin use). */
  reset(name: string): void {
    this.circuits.delete(name);
    this.logger.log(`[CircuitBreaker] "${name}" manually reset to CLOSED`);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private getOrCreate(name: string): CircuitStats {
    if (!this.circuits.has(name)) {
      this.circuits.set(name, { state: CircuitState.CLOSED, failures: 0, successes: 0 });
    }
    return this.circuits.get(name)!;
  }

  private onSuccess(name: string, circuit: CircuitStats, opts: Required<CircuitBreakerOptions>): void {
    circuit.failures = 0;

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.successes += 1;
      if (circuit.successes >= opts.successThreshold) {
        circuit.state = CircuitState.CLOSED;
        circuit.successes = 0;
        this.logger.log(`[CircuitBreaker] "${name}" → CLOSED (recovered)`);
      }
    }
  }

  private onFailure(name: string, circuit: CircuitStats, opts: Required<CircuitBreakerOptions>): void {
    circuit.failures += 1;
    circuit.lastFailureAt = new Date();

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.state = CircuitState.OPEN;
      circuit.openedAt = new Date();
      circuit.successes = 0;
      this.logger.warn(`[CircuitBreaker] "${name}" → OPEN (probe failed)`);
      return;
    }

    if (circuit.failures >= opts.failureThreshold) {
      circuit.state = CircuitState.OPEN;
      circuit.openedAt = new Date();
      this.logger.warn(
        `[CircuitBreaker] "${name}" → OPEN after ${circuit.failures} consecutive failures`,
      );
    }
  }

  private shouldAttemptRecovery(circuit: CircuitStats, opts: Required<CircuitBreakerOptions>): boolean {
    if (!circuit.openedAt) return false;
    return Date.now() - circuit.openedAt.getTime() >= opts.recoveryTimeMs;
  }
}
