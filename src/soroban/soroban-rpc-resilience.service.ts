import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CircuitBreakerService, CircuitState } from '../http/circuit-breaker.service';
import { StellarConfigService } from '../config/stellar.service';

/** Name under which Soroban RPC calls are tracked in CircuitBreakerService / GET /metrics/circuit-breakers. */
export const SOROBAN_RPC_CIRCUIT = 'soroban-rpc';

/** Logical service the circuit protects — included in every operational alert. */
export const SOROBAN_RPC_SERVICE = 'soroban-rpc';

/** Event emitted on the shared EventEmitter2 bus when the Soroban RPC circuit trips (issue #852's `SorobanCircuitOpened`). */
export const SOROBAN_CIRCUIT_OPENED_EVENT = 'soroban.circuit_opened';

/** Event emitted when the circuit moves to HALF_OPEN to probe recovery. */
export const SOROBAN_CIRCUIT_HALF_OPEN_EVENT = 'soroban.circuit_half_open';

/** Event emitted when the circuit closes again (recovered) after successful probes. */
export const SOROBAN_CIRCUIT_RECOVERED_EVENT = 'soroban.circuit_recovered';

/**
 * Structured context attached to every circuit transition event so alerting
 * consumers know which network/service is affected without re-reading config.
 */
export interface SorobanCircuitTransition {
  circuit: string;
  service: string;
  network: string;
  previousState: CircuitState;
  state: CircuitState;
  /** Operation label passed to `execute` (e.g. `getAccount`). */
  operation: string;
  timestamp: Date;
}

/** Maps a circuit state to the event emitted when the circuit enters it. */
const EVENT_BY_STATE: Record<CircuitState, string> = {
  [CircuitState.OPEN]: SOROBAN_CIRCUIT_OPENED_EVENT,
  [CircuitState.HALF_OPEN]: SOROBAN_CIRCUIT_HALF_OPEN_EVENT,
  [CircuitState.CLOSED]: SOROBAN_CIRCUIT_RECOVERED_EVENT,
};

/** HTTP status codes treated as transient and safe to retry. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Backoff delay (ms) before each retry attempt: 500ms, 1s, 2s. */
const RETRY_DELAYS_MS = [500, 1000, 2000];

/**
 * SorobanRpcResilienceService
 *
 * Wraps Soroban RPC calls with retry-with-backoff and a circuit breaker
 * (issue #852), mirroring HttpRetryModule's resilience for HTTP calls.
 *
 *  - Retries transient failures (network errors, timeouts, 429/5xx) up to
 *    3 times with exponential backoff (500ms, 1s, 2s).
 *  - Does not retry non-retryable 4xx validation errors.
 *  - Routes every call through the shared 'soroban-rpc' circuit breaker
 *    (see CircuitBreakerService): after 5 consecutive failures the circuit
 *    opens for 30s, then allows a single probe request (half-open).
 *  - Emits a structured transition event (`opened`/`half_open`/`recovered`)
 *    on the shared EventEmitter2 bus the moment the circuit changes state,
 *    so operators can be paged (see SorobanCircuitListener).
 */
@Injectable()
export class SorobanRpcResilienceService {
  private readonly logger = new Logger(SorobanRpcResilienceService.name);

  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly stellarConfig?: StellarConfigService,
  ) {}

  /** Runs `fn` through the retry policy and the Soroban RPC circuit breaker. */
  async execute<T>(fn: () => Promise<T>, label: string): Promise<T> {
    const stateBefore = this.circuitBreaker.getState(SOROBAN_RPC_CIRCUIT);
    try {
      const result = await this.circuitBreaker.execute(SOROBAN_RPC_CIRCUIT, () =>
        this.executeWithRetry(fn, label),
      );
      this.emitTransitionIfChanged(stateBefore, label);
      return result;
    } catch (error) {
      this.emitTransitionIfChanged(stateBefore, label);
      throw error;
    }
  }

  private async executeWithRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const isLastAttempt = attempt === RETRY_DELAYS_MS.length;
        if (isLastAttempt || !this.isRetryableError(error)) {
          throw error;
        }
        const delay = RETRY_DELAYS_MS[attempt];
        this.logger.warn(
          `Soroban ${label} attempt ${attempt + 1} failed (${this.errorMessage(error)}). Retrying in ${delay}ms…`,
        );
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /** Transient network/timeout errors and HTTP 429/5xx are retryable; other 4xx errors are not. */
  private isRetryableError(error: unknown): boolean {
    const status = this.extractStatusCode(error);
    // No HTTP status attached — a network failure or timeout, always transient.
    return status === undefined || RETRYABLE_STATUSES.has(status);
  }

  private extractStatusCode(error: unknown): number | undefined {
    const err = error as {
      status?: number;
      statusCode?: number;
      response?: { status?: number };
    };
    return err?.response?.status ?? err?.status ?? err?.statusCode;
  }

  private emitTransitionIfChanged(previousState: CircuitState, operation: string): void {
    const state = this.circuitBreaker.getState(SOROBAN_RPC_CIRCUIT);
    // Only a real state change is an alertable transition — repeated calls while
    // the circuit is already OPEN must not page on-call again.
    if (state === previousState) return;

    const event = EVENT_BY_STATE[state];
    if (!event) return;

    this.eventEmitter.emit(event, this.buildTransitionPayload(previousState, state, operation));
  }

  private buildTransitionPayload(
    previousState: CircuitState,
    state: CircuitState,
    operation: string,
  ): SorobanCircuitTransition {
    return {
      circuit: SOROBAN_RPC_CIRCUIT,
      service: SOROBAN_RPC_SERVICE,
      network: this.stellarConfig?.network ?? process.env.STELLAR_NETWORK ?? 'unknown',
      previousState,
      state,
      operation,
      timestamp: new Date(),
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
