import { CircuitBreakerController } from './circuit-breaker.controller';
import { CircuitBreakerService, CircuitState } from './circuit-breaker.service';

describe('CircuitBreakerController', () => {
  let controller: CircuitBreakerController;
  let service: CircuitBreakerService;

  beforeEach(() => {
    service = new CircuitBreakerService();
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    controller = new CircuitBreakerController(service);
  });

  describe('resetCircuit (#1375)', () => {
    it('resets the named circuit and attributes the action to the authenticated admin', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 5; i++) {
        await expect(service.execute('svc', fn)).rejects.toThrow();
      }
      expect(service.getState('svc')).toBe(CircuitState.OPEN);

      const result = controller.resetCircuit('svc', { user: { id: 'admin-42' } });

      expect(result).toEqual({ name: 'svc', state: CircuitState.CLOSED });
      const log = service.getAuditLog('svc');
      expect(log[0]).toMatchObject({ circuit: 'svc', actor: 'admin-42', action: 'MANUAL_RESET' });
    });

    it('falls back to email, then "unknown", when no user id is present', () => {
      controller.resetCircuit('svc-b', { user: { email: 'ops@example.com' } });
      expect(service.getAuditLog('svc-b')[0].actor).toBe('ops@example.com');

      controller.resetCircuit('svc-c', {});
      expect(service.getAuditLog('svc-c')[0].actor).toBe('unknown');
    });
  });

  describe('getAuditLog (#1375)', () => {
    it('serializes audit entries with ISO timestamps', () => {
      controller.resetCircuit('svc-d', { user: { id: 'admin-1' } });
      const entries = controller.getAuditLog();
      expect(entries[0]).toMatchObject({ circuit: 'svc-d', actor: 'admin-1', action: 'MANUAL_RESET' });
      expect(typeof entries[0].at).toBe('string');
      expect(() => new Date(entries[0].at)).not.toThrow();
    });
  });

  describe('getCircuitStatuses', () => {
    it('lists current state for every circuit that has handled a call', async () => {
      await service.execute('svc-e', jest.fn().mockResolvedValue('ok'));
      const statuses = controller.getCircuitStatuses();
      expect(statuses.find((s) => s.name === 'svc-e')).toMatchObject({
        state: CircuitState.CLOSED,
        failureCount: 0,
      });
    });
  });
});
