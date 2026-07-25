import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SorobanRpcResilienceService,
  SOROBAN_RPC_CIRCUIT,
  SOROBAN_CIRCUIT_OPENED_EVENT,
} from './soroban-rpc-resilience.service';
import { CircuitBreakerService, CircuitState } from '../http/circuit-breaker.service';

// ── Helpers ────────────────────────────────────────────────────────────────────

function rateLimitError() {
  return Object.assign(new Error('Too Many Requests'), { response: { status: 429 } });
}

function networkTimeoutError() {
  return Object.assign(new Error('ETIMEDOUT'), {});
}

function validationError() {
  return Object.assign(new Error('Bad Request'), { response: { status: 400 } });
}

function makeService(): {
  service: SorobanRpcResilienceService;
  circuitBreaker: CircuitBreakerService;
  eventEmitter: EventEmitter2;
} {
  const circuitBreaker = new CircuitBreakerService();
  const eventEmitter = new EventEmitter2();
  const service = new SorobanRpcResilienceService(circuitBreaker, eventEmitter);

  // Skip real backoff delays — matches the sleep-spy pattern used in HttpRetryService's tests.
  jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

  return { service, circuitBreaker, eventEmitter };
}

// ── Tests (issue #852) ───────────────────────────────────────────────────────

describe('SorobanRpcResilienceService', () => {
  it('succeeds on the first attempt without retrying', async () => {
    const { service } = makeService();
    const fn = jest.fn().mockResolvedValue('ok');

    await expect(service.execute(fn, 'getAccount')).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds on the second attempt after a transient 429', async () => {
    const { service } = makeService();
    const fn = jest.fn().mockRejectedValueOnce(rateLimitError()).mockResolvedValueOnce('ok');

    await expect(service.execute(fn, 'getAccount')).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('fails after exhausting all retries on a persistent transient error', async () => {
    const { service } = makeService();
    const fn = jest.fn().mockRejectedValue(networkTimeoutError());

    await expect(service.execute(fn, 'getAccount')).rejects.toThrow('ETIMEDOUT');
    // 1 initial attempt + 3 retries (500ms, 1s, 2s backoff)
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('does not retry a 4xx validation error', async () => {
    const { service } = makeService();
    const fn = jest.fn().mockRejectedValue(validationError());

    await expect(service.execute(fn, 'getAccount')).rejects.toThrow('Bad Request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit after 5 consecutive failures and emits SorobanCircuitOpened', async () => {
    const { service, circuitBreaker, eventEmitter } = makeService();
    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    const fn = jest.fn().mockRejectedValue(validationError());

    for (let i = 0; i < 5; i++) {
      await expect(service.execute(fn, 'getAccount')).rejects.toThrow('Bad Request');
    }

    expect(circuitBreaker.getState(SOROBAN_RPC_CIRCUIT)).toBe(CircuitState.OPEN);
    expect(emitSpy).toHaveBeenCalledWith(
      SOROBAN_CIRCUIT_OPENED_EVENT,
      expect.objectContaining({ circuit: SOROBAN_RPC_CIRCUIT }),
    );

    // Circuit is now open — further calls are rejected without invoking fn.
    fn.mockClear();
    await expect(service.execute(fn, 'getAccount')).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();

    // Only one open-transition event was emitted, not one per rejected call.
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });
});
