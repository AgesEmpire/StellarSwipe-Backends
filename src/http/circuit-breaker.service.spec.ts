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
