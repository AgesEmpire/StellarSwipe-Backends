import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { Counter, Gauge, Registry } from 'prom-client';

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
  /**
   * Maximum number of concurrent probe requests allowed through while the
   * circuit is HALF_OPEN. Default: 1.
   *
   * Without this bound, every caller waiting on a recovering dependency
   * would be let through the instant the recovery timer elapses — a probe
   * "stampede" that can re-overwhelm a dependency that just started coming
   * back up. Extra calls beyond this limit are rejected immediately (same
   * as the OPEN state) until a probe slot frees up.
   */
  halfOpenMaxProbes?: number;
}

/** A single recorded manual (operator-triggered) action against a circuit. */
export interface CircuitAuditEntry {
  circuit: string;
  action: 'MANUAL_RESET';
  actor: string;
  at: Date;
  previousState: CircuitState;
}

interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt?: Date;
  openedAt?: Date;
  /** Probe requests currently in flight while state === HALF_OPEN. */
  probesInFlight: number;
}

/** Numeric encoding for Prometheus gauge: CLOSED=0, HALF_OPEN=1, OPEN=2 */
const STATE_VALUE: Record<CircuitState, number> = {
  [CircuitState.CLOSED]: 0,
  [CircuitState.HALF_OPEN]: 1,
  [CircuitState.OPEN]: 2,
};

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
 * Prometheus metrics exposed (when a Registry is injected):
 *  circuit_breaker_state          gauge   – current state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)
 *  circuit_breaker_transitions_total counter – state transitions labelled by direction
 *  circuit_breaker_calls_total    counter – total executions (labelled outcome: success|failure|rejected)
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
    halfOpenMaxProbes: 1,
  };

  /** In-memory audit trail of manual (operator-triggered) circuit actions. */
  private readonly auditTrail: CircuitAuditEntry[] = [];

  // Prometheus metrics – optional so the service remains usable without a registry
  private stateGauge?: Gauge;
  private transitionsCounter?: Counter;
  private callsCounter?: Counter;

  constructor(@Optional() private readonly prometheusRegistry?: Registry) {
    if (prometheusRegistry) {
      this.stateGauge = new Gauge({
        name: 'circuit_breaker_state',
        help: 'Current circuit breaker state: 0=CLOSED, 1=HALF_OPEN, 2=OPEN',
        labelNames: ['circuit'],
        registers: [prometheusRegistry],
      });

      this.transitionsCounter = new Counter({
        name: 'circuit_breaker_transitions_total',
        help: 'Total circuit breaker state transitions',
        labelNames: ['circuit', 'from', 'to'],
        registers: [prometheusRegistry],
      });

      this.callsCounter = new Counter({
        name: 'circuit_breaker_calls_total',
        help: 'Total calls routed through circuit breakers',
        labelNames: ['circuit', 'outcome'],
        registers: [prometheusRegistry],
      });
    }
  }

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
        this.transition(name, circuit, CircuitState.HALF_OPEN);
        this.logger.log(`[CircuitBreaker] "${name}" → HALF_OPEN (probing)`);
      } else {
        this.logger.warn(`[CircuitBreaker] "${name}" is OPEN — rejecting request`);
        this.callsCounter?.inc({ circuit: name, outcome: 'rejected' });
        if (fallback) return fallback();
        throw new ServiceUnavailableException(
          `Service "${name}" is temporarily unavailable. Please try again later.`,
        );
      }
    }

    // Bound how many probes may run concurrently while recovering: once the
    // circuit is HALF_OPEN, only `halfOpenMaxProbes` calls are let through at
    // a time. Everyone else is rejected exactly like OPEN, so a crowd of
    // waiting callers can't flood a dependency that's still coming back up.
    let countedAsProbe = false;
    if (circuit.state === CircuitState.HALF_OPEN) {
      if (circuit.probesInFlight >= opts.halfOpenMaxProbes) {
        this.logger.warn(
          `[CircuitBreaker] "${name}" is HALF_OPEN with ${circuit.probesInFlight} probe(s) ` +
            `already in flight (limit ${opts.halfOpenMaxProbes}) — rejecting request`,
        );
        this.callsCounter?.inc({ circuit: name, outcome: 'rejected' });
        if (fallback) return fallback();
        throw new ServiceUnavailableException(
          `Service "${name}" is temporarily unavailable. Please try again later.`,
        );
      }
      circuit.probesInFlight += 1;
      countedAsProbe = true;
    }

    try {
      const result = await fn();
      this.callsCounter?.inc({ circuit: name, outcome: 'success' });
      this.onSuccess(name, circuit, opts);
      return result;
    } catch (error) {
      this.callsCounter?.inc({ circuit: name, outcome: 'failure' });
      this.onFailure(name, circuit, opts);
      if (fallback) return fallback();
      throw error;
    } finally {
      if (countedAsProbe) {
        circuit.probesInFlight = Math.max(0, circuit.probesInFlight - 1);
      }
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

  /**
   * Manually reset a circuit to CLOSED — the operator control for recovering
   * a circuit after confirming the dependency it guards has been restored,
   * without waiting for the automatic half-open probe cycle.
   *
   * `actor` identifies who authorized the action (e.g. an admin user id) and
   * is required so the action lands in the audit trail returned by
   * {@link getAuditLog}; callers that omit it get `'unknown'` recorded
   * rather than silently skipping the audit entry.
   */
  reset(name: string, actor = 'unknown'): void {
    const circuit = this.circuits.get(name);
    const previousState = circuit?.state ?? CircuitState.CLOSED;
    if (circuit) {
      this.circuits.delete(name);
      this.transitionsCounter?.inc({ circuit: name, from: previousState, to: CircuitState.CLOSED });
      this.stateGauge?.set({ circuit: name }, STATE_VALUE[CircuitState.CLOSED]);
    }
    this.auditTrail.push({
      circuit: name,
      action: 'MANUAL_RESET',
      actor,
      at: new Date(),
      previousState,
    });
    this.logger.log(`[CircuitBreaker] "${name}" manually reset to CLOSED by "${actor}"`);
  }

  /**
   * Returns the audit trail of manual circuit actions, most recent first.
   * Pass `name` to filter to a single circuit.
   */
  getAuditLog(name?: string): CircuitAuditEntry[] {
    const entries = name
      ? this.auditTrail.filter((e) => e.circuit === name)
      : [...this.auditTrail];
    return entries.slice().reverse();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private getOrCreate(name: string): CircuitStats {
    if (!this.circuits.has(name)) {
      const stats: CircuitStats = {
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
        probesInFlight: 0,
      };
      this.circuits.set(name, stats);
      this.stateGauge?.set({ circuit: name }, STATE_VALUE[CircuitState.CLOSED]);
    }
    return this.circuits.get(name)!;
  }

  /** Record a state transition in both the internal map and Prometheus. */
  private transition(name: string, circuit: CircuitStats, next: CircuitState): void {
    const prev = circuit.state;
    circuit.state = next;
    this.transitionsCounter?.inc({ circuit: name, from: prev, to: next });
    this.stateGauge?.set({ circuit: name }, STATE_VALUE[next]);
  }

  private onSuccess(name: string, circuit: CircuitStats, opts: Required<CircuitBreakerOptions>): void {
    circuit.failures = 0;

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.successes += 1;
      if (circuit.successes >= opts.successThreshold) {
        circuit.successes = 0;
        this.transition(name, circuit, CircuitState.CLOSED);
        this.logger.log(`[CircuitBreaker] "${name}" → CLOSED (recovered)`);
      }
    }
  }

  private onFailure(name: string, circuit: CircuitStats, opts: Required<CircuitBreakerOptions>): void {
    circuit.failures += 1;
    circuit.lastFailureAt = new Date();

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.openedAt = new Date();
      circuit.successes = 0;
      this.transition(name, circuit, CircuitState.OPEN);
      this.logger.warn(`[CircuitBreaker] "${name}" → OPEN (probe failed)`);
      return;
    }

    if (circuit.failures >= opts.failureThreshold) {
      circuit.openedAt = new Date();
      this.transition(name, circuit, CircuitState.OPEN);
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
