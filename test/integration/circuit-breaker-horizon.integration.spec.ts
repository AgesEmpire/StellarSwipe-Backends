/**
 * Integration examples for Horizon circuit breakers (issue #1033).
 */

import {
  CircuitBreaker,
  CircuitOpenError,
} from '../../src/common/circuit-breaker/circuit-breaker';
import { HorizonCircuitService } from '../../src/stellar/horizon-circuit.service';

describe('Horizon circuit breaker (#1033)', () => {
  describe('CircuitBreaker', () => {
    it('stays closed while under failure threshold', async () => {
      const cb = new CircuitBreaker({
        name: 'test',
        failureThreshold: 3,
        resetTimeoutMs: 60_000,
      });

      await expect(cb.exec(async () => 'ok')).resolves.toBe('ok');
      expect(cb.getState()).toBe('closed');
    });

    it('opens after consecutive failures and fails fast', async () => {
      const cb = new CircuitBreaker({
        name: 'test-open',
        failureThreshold: 2,
        resetTimeoutMs: 60_000,
      });

      await expect(
        cb.exec(async () => {
          throw new Error('horizon down');
        }),
      ).rejects.toThrow('horizon down');
      await expect(
        cb.exec(async () => {
          throw new Error('horizon down');
        }),
      ).rejects.toThrow('horizon down');

      expect(cb.getState()).toBe('open');
      await expect(cb.exec(async () => 'should-not-run')).rejects.toBeInstanceOf(
        CircuitOpenError,
      );
    });

    it('transitions to half-open after reset timeout and can close on success', async () => {
      const cb = new CircuitBreaker({
        name: 'test-recover',
        failureThreshold: 1,
        successThreshold: 1,
        resetTimeoutMs: 0, // immediate probe
      });

      await expect(
        cb.exec(async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow('fail');
      expect(cb.getState()).toBe('open');

      // resetTimeoutMs=0 → getState promotes to half-open
      expect(cb.getState()).toBe('half-open');

      await expect(cb.exec(async () => 'recovered')).resolves.toBe('recovered');
      expect(cb.getState()).toBe('closed');
    });
  });

  describe('HorizonCircuitService', () => {
    it('exposes independent read and write breakers', async () => {
      const svc = new HorizonCircuitService();

      await expect(svc.executeRead(async () => ({ balances: [] }))).resolves.toEqual({
        balances: [],
      });

      // trip writes only
      for (let i = 0; i < 5; i++) {
        await svc
          .executeWrite(async () => {
            throw new Error('submit failed');
          })
          .catch(() => undefined);
      }

      const metrics = svc.getMetrics();
      expect(metrics.writes.state).toBe('open');
      // reads should still be closed
      expect(metrics.reads.state).toBe('closed');
      await expect(svc.executeRead(async () => 'still-ok')).resolves.toBe(
        'still-ok',
      );
    });
  });
});
