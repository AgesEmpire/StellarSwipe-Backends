import { ServiceUnavailableException } from '@nestjs/common';
import { Registry } from 'prom-client';
import { CircuitBreakerService, CircuitState } from './circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
    service = new CircuitBreakerService(registry);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  describe('CLOSED state', () => {
    it('executes fn and returns result when healthy', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      const result = await service.execute('svc', fn);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('opens circuit after failureThreshold consecutive failures', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('timeout'));
      const opts = { failureThreshold: 3, recoveryTimeMs: 30_000, successThreshold: 2 };

      for (let i = 0; i < 3; i++) {
        await expect(service.execute('svc', fn, opts)).rejects.toThrow('timeout');
      }

      expect(service.getState('svc')).toBe(CircuitState.OPEN);
    });

    it('resets failure count on success', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('ok');

      await expect(service.execute('svc', fn, { failureThreshold: 3 })).rejects.toThrow();
      await service.execute('svc', fn, { failureThreshold: 3 });

      expect(service.getState('svc')).toBe(CircuitState.CLOSED);
    });
  });

  describe('OPEN state', () => {
    async function openCircuit(name: string, threshold = 3) {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < threshold; i++) {
        await expect(service.execute(name, fn, { failureThreshold: threshold, recoveryTimeMs: 60_000 })).rejects.toThrow();
      }
    }

    it('rejects immediately without calling fn', async () => {
      await openCircuit('svc');
      const fn = jest.fn().mockResolvedValue('ok');
      await expect(service.execute('svc', fn, { failureThreshold: 3, recoveryTimeMs: 60_000 })).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(fn).not.toHaveBeenCalled();
    });

    it('returns fallback value when circuit is OPEN', async () => {
      await openCircuit('svc');
      const fn = jest.fn().mockResolvedValue('ok');
      const result = await service.execute('svc', fn, { failureThreshold: 3, recoveryTimeMs: 60_000 }, () => 'fallback');
      expect(result).toBe('fallback');
      expect(fn).not.toHaveBeenCalled();
    });

    it('transitions to HALF_OPEN after recoveryTimeMs', async () => {
      await openCircuit('svc');

      // Manually backdate openedAt to simulate elapsed recovery time
      const circuit = (service as any).circuits.get('svc');
      circuit.openedAt = new Date(Date.now() - 31_000);

      const fn = jest.fn().mockResolvedValue('ok');
      await service.execute('svc', fn, { failureThreshold: 3, recoveryTimeMs: 30_000, successThreshold: 1 });

      expect(service.getState('svc')).toBe(CircuitState.CLOSED);
    });
  });

  describe('HALF_OPEN state', () => {
    it('closes circuit after successThreshold successes', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      const opts = { failureThreshold: 2, recoveryTimeMs: 0, successThreshold: 2 };

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(service.execute('svc', fn, opts)).rejects.toThrow();
      }

      // Probe succeeds twice → CLOSED
      fn.mockResolvedValue('ok');
      await service.execute('svc', fn, opts);
      await service.execute('svc', fn, opts);

      expect(service.getState('svc')).toBe(CircuitState.CLOSED);
    });

    it('re-opens circuit if probe fails', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      const opts = { failureThreshold: 2, recoveryTimeMs: 0, successThreshold: 2 };

      for (let i = 0; i < 2; i++) {
        await expect(service.execute('svc', fn, opts)).rejects.toThrow();
      }

      // Probe fails → back to OPEN
      await expect(service.execute('svc', fn, opts)).rejects.toThrow();
      expect(service.getState('svc')).toBe(CircuitState.OPEN);
    });
  });

  describe('fallback', () => {
    it('returns fallback when fn throws (CLOSED state)', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      const result = await service.execute('svc', fn, {}, () => 'default');
      expect(result).toBe('default');
    });
  });

  describe('reset', () => {
    it('resets circuit to CLOSED', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 5; i++) {
        await expect(service.execute('svc', fn)).rejects.toThrow();
      }
      service.reset('svc');
      expect(service.getState('svc')).toBe(CircuitState.CLOSED);
    });
  });

  describe('HALF_OPEN probe concurrency limit (#1375)', () => {
    async function openCircuit(name: string, opts: any) {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < opts.failureThreshold; i++) {
        await expect(service.execute(name, fn, opts)).rejects.toThrow();
      }
      // Backdate so the next call is eligible to probe.
      const circuit = (service as any).circuits.get(name);
      circuit.openedAt = new Date(Date.now() - opts.recoveryTimeMs - 1000);
    }

    it('rejects extra concurrent probes beyond halfOpenMaxProbes', async () => {
      const opts = { failureThreshold: 2, recoveryTimeMs: 1000, halfOpenMaxProbes: 1 };
      await openCircuit('svc', opts);

      let releaseFirstProbe: () => void;
      const firstProbe = new Promise<string>((resolve) => {
        releaseFirstProbe = () => resolve('first-ok');
      });
      const slowFn = jest.fn().mockReturnValue(firstProbe);

      // First call transitions OPEN → HALF_OPEN and occupies the single probe slot.
      const firstCall = service.execute('svc', slowFn, opts);

      // A second concurrent call arrives while the first probe is still in flight.
      const fastFn = jest.fn().mockResolvedValue('second');
      await expect(service.execute('svc', fastFn, opts)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(fastFn).not.toHaveBeenCalled();

      releaseFirstProbe();
      await expect(firstCall).resolves.toBe('first-ok');
    });

    it('allows up to halfOpenMaxProbes concurrent probes', async () => {
      const opts = { failureThreshold: 2, recoveryTimeMs: 1000, halfOpenMaxProbes: 2 };
      await openCircuit('svc2', opts);

      let resolveA: () => void;
      let resolveB: () => void;
      const probeA = new Promise<string>((r) => (resolveA = () => r('a')));
      const probeB = new Promise<string>((r) => (resolveB = () => r('b')));

      const callA = service.execute('svc2', () => probeA, opts);
      const callB = service.execute('svc2', () => probeB, opts);

      // A third concurrent call should now be rejected.
      const thirdFn = jest.fn().mockResolvedValue('c');
      await expect(service.execute('svc2', thirdFn, opts)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(thirdFn).not.toHaveBeenCalled();

      resolveA();
      resolveB();
      await expect(callA).resolves.toBe('a');
      await expect(callB).resolves.toBe('b');
    });

    it('frees the probe slot after a probe fails, allowing the next probe through', async () => {
      const opts = { failureThreshold: 2, recoveryTimeMs: 1000, halfOpenMaxProbes: 1, successThreshold: 1 };
      await openCircuit('svc3', opts);

      const failingProbe = jest.fn().mockRejectedValue(new Error('still down'));
      await expect(service.execute('svc3', failingProbe, opts)).rejects.toThrow('still down');
      expect(service.getState('svc3')).toBe(CircuitState.OPEN);

      // Backdate again so a fresh probe is eligible.
      const circuit = (service as any).circuits.get('svc3');
      circuit.openedAt = new Date(Date.now() - opts.recoveryTimeMs - 1000);

      const recoveringFn = jest.fn().mockResolvedValue('ok');
      await expect(service.execute('svc3', recoveringFn, opts)).resolves.toBe('ok');
      expect(service.getState('svc3')).toBe(CircuitState.CLOSED);
    });
  });

  describe('manual reset audit trail (#1375)', () => {
    it('records the actor and previous state on manual reset', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 5; i++) {
        await expect(service.execute('svc-audit', fn)).rejects.toThrow();
      }
      expect(service.getState('svc-audit')).toBe(CircuitState.OPEN);

      service.reset('svc-audit', 'admin-123');

      const log = service.getAuditLog('svc-audit');
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        circuit: 'svc-audit',
        action: 'MANUAL_RESET',
        actor: 'admin-123',
        previousState: CircuitState.OPEN,
      });
      expect(log[0].at).toBeInstanceOf(Date);
    });

    it('defaults actor to "unknown" when not provided', () => {
      service.reset('svc-audit-2');
      expect(service.getAuditLog('svc-audit-2')[0].actor).toBe('unknown');
    });

    it('returns entries most-recent-first and filters by circuit name', () => {
      service.reset('svc-x', 'alice');
      service.reset('svc-y', 'bob');
      service.reset('svc-x', 'carol');

      const all = service.getAuditLog();
      expect(all[0]).toMatchObject({ circuit: 'svc-x', actor: 'carol' });

      const xOnly = service.getAuditLog('svc-x');
      expect(xOnly.map((e) => e.actor)).toEqual(['carol', 'alice']);
    });
  });

  describe('getAllStats', () => {
    it('returns stats for all circuits', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      await service.execute('svc-a', fn);
      await service.execute('svc-b', fn);
      const stats = service.getAllStats();
      expect(stats['svc-a']).toBeDefined();
      expect(stats['svc-b']).toBeDefined();
    });
  });

  describe('Prometheus metrics', () => {
    it('records calls counter on success', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      await service.execute('svc', fn);
      const metrics = await registry.metrics();
      expect(metrics).toContain('circuit_breaker_calls_total');
      expect(metrics).toContain('outcome="success"');
    });

    it('records calls counter on failure', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      await expect(service.execute('svc', fn, {}, () => 'fb')).resolves.toBe('fb');
      const metrics = await registry.metrics();
      expect(metrics).toContain('outcome="failure"');
    });

    it('records rejected outcome when circuit is OPEN', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      const opts = { failureThreshold: 2, recoveryTimeMs: 60_000 };
      for (let i = 0; i < 2; i++) {
        await expect(service.execute('svc', fn, opts)).rejects.toThrow();
      }
      await expect(service.execute('svc', fn, opts)).rejects.toThrow(ServiceUnavailableException);
      const metrics = await registry.metrics();
      expect(metrics).toContain('outcome="rejected"');
    });

    it('records state gauge transitions', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      const opts = { failureThreshold: 2, recoveryTimeMs: 60_000 };
      for (let i = 0; i < 2; i++) {
        await expect(service.execute('svc', fn, opts)).rejects.toThrow();
      }
      const metrics = await registry.metrics();
      expect(metrics).toContain('circuit_breaker_state');
      expect(metrics).toContain('circuit="svc"');
    });

    it('records transition counter on state change', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      const opts = { failureThreshold: 2, recoveryTimeMs: 0, successThreshold: 1 };
      // Open
      for (let i = 0; i < 2; i++) {
        await expect(service.execute('svc', fn, opts)).rejects.toThrow();
      }
      // Probe + recover
      fn.mockResolvedValueOnce('ok');
      await service.execute('svc', fn, opts);

      const metrics = await registry.metrics();
      expect(metrics).toContain('circuit_breaker_transitions_total');
    });

    it('works without a registry (no metrics injected)', async () => {
      const bare = new CircuitBreakerService();
      jest.spyOn((bare as any).logger, 'warn').mockImplementation(() => {});
      jest.spyOn((bare as any).logger, 'log').mockImplementation(() => {});
      const fn = jest.fn().mockResolvedValue('bare-ok');
      await expect(bare.execute('svc', fn)).resolves.toBe('bare-ok');
    });
  });
});
