import { CircuitBreakerService, CircuitState } from '../src/http/circuit-breaker.service';
import { CircuitBreakerController } from '../src/http/circuit-breaker.controller';

describe('CircuitBreakerController', () => {
  let controller: CircuitBreakerController;
  let service: CircuitBreakerService;

  beforeEach(() => {
    service = new CircuitBreakerService();
    controller = new CircuitBreakerController(service);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
  });

  it('returns empty array when no circuits exist', () => {
    const result = controller.getCircuitStatuses();
    expect(result).toEqual([]);
  });

  it('lists all registered circuits with their current state', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await service.execute('stellar-horizon', fn);
    await service.execute('price-oracle', fn);

    const result = controller.getCircuitStatuses();

    expect(result).toHaveLength(2);
    const names = result.map((c) => c.name);
    expect(names).toContain('stellar-horizon');
    expect(names).toContain('price-oracle');
    expect(result[0].state).toBe(CircuitState.CLOSED);
  });

  it('reflects OPEN state and failure count after failures', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('timeout'));
    const opts = { failureThreshold: 3, recoveryTimeMs: 60_000 };

    for (let i = 0; i < 3; i++) {
      await service.execute('stellar-horizon', fn, opts).catch(() => {});
    }

    const result = controller.getCircuitStatuses();
    const horizon = result.find((c) => c.name === 'stellar-horizon');

    expect(horizon).toBeDefined();
    expect(horizon!.state).toBe(CircuitState.OPEN);
    expect(horizon!.failureCount).toBeGreaterThanOrEqual(3);
    expect(horizon!.lastFailureAt).not.toBeNull();
    expect(horizon!.lastStateChangeAt).not.toBeNull();
  });

  it('reflects HALF_OPEN state after recovery timeout', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const opts = { failureThreshold: 2, recoveryTimeMs: 0, successThreshold: 2 };

    for (let i = 0; i < 2; i++) {
      await service.execute('svc', fn, opts).catch(() => {});
    }

    fn.mockResolvedValueOnce('ok');
    await service.execute('svc', fn, opts);

    const result = controller.getCircuitStatuses();
    const svc = result.find((c) => c.name === 'svc');

    expect(svc).toBeDefined();
    expect(svc!.state).toBe(CircuitState.HALF_OPEN);
  });

  it('reflects state change back to CLOSED after recovery', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const opts = { failureThreshold: 2, recoveryTimeMs: 0, successThreshold: 1 };

    for (let i = 0; i < 2; i++) {
      await service.execute('svc', fn, opts).catch(() => {});
    }

    fn.mockResolvedValue('ok');
    await service.execute('svc', fn, opts);

    const result = controller.getCircuitStatuses();
    const svc = result.find((c) => c.name === 'svc');

    expect(svc!.state).toBe(CircuitState.CLOSED);
    expect(svc!.failureCount).toBe(0);
  });

  it('includes null timestamps for circuits that have never failed', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await service.execute('healthy-svc', fn);

    const result = controller.getCircuitStatuses();
    const svc = result.find((c) => c.name === 'healthy-svc');

    expect(svc!.lastFailureAt).toBeNull();
    expect(svc!.lastStateChangeAt).toBeNull();
  });
});
