import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CircuitBreakerService, CircuitState } from '../http/circuit-breaker.service';

/** Name under which Soroban RPC calls are tracked in CircuitBreakerService / GET /metrics/circuit-breakers. */
export const SOROBAN_RPC_CIRCUIT = 'soroban-rpc';

/** Event emitted on the shared EventEmitter2 bus when the Soroban RPC circuit trips (issue #852's `SorobanCircuitOpened`). */
export const SOROBAN_CIRCUIT_OPENED_EVENT = 'soroban.circuit_opened';

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
 *  - Emits `SorobanCircuitOpened` on the shared EventEmitter2 bus the
 *    moment the circuit trips.
 */
@Injectable()
export class SorobanRpcResilienceService {
  private readonly logger = new Logger(SorobanRpcResilienceService.name);

  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Runs `fn` through the retry policy and the Soroban RPC circuit breaker. */
  async execute<T>(fn: () => Promise<T>, label: string): Promise<T> {
    const stateBefore = this.circuitBreaker.getState(SOROBAN_RPC_CIRCUIT);
    try {
      return await this.circuitBreaker.execute(SOROBAN_RPC_CIRCUIT, () =>
        this.executeWithRetry(fn, label),
      );
    } catch (error) {
      this.emitCircuitOpenedIfJustTripped(stateBefore);
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

  private emitCircuitOpenedIfJustTripped(stateBefore: CircuitState): void {
    if (
      stateBefore !== CircuitState.OPEN &&
      this.circuitBreaker.getState(SOROBAN_RPC_CIRCUIT) === CircuitState.OPEN
    ) {
      this.eventEmitter.emit(SOROBAN_CIRCUIT_OPENED_EVENT, {
        circuit: SOROBAN_RPC_CIRCUIT,
        timestamp: new Date(),
      });
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
