import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  RotationService,
  SECRET_ROTATED_EVENT,
  SecretRotatedPayload,
} from '../src/secrets/rotation.service';

const makeService = () => {
  const events = new EventEmitter2();
  const svc = new RotationService(events);
  return { svc, events };
};

describe('RotationService', () => {
  afterEach(() => jest.useRealTimers());

  // ── register ──────────────────────────────────────────────────────────────

  describe('register()', () => {
    it('stores the initial value', () => {
      const { svc } = makeService();
      svc.register('jwt', 'initial-secret');
      expect(svc.get('jwt')).toBe('initial-secret');
    });

    it('lists the registered name', () => {
      const { svc } = makeService();
      svc.register('db-password', 'pw');
      expect(svc.listNames()).toContain('db-password');
    });

    it('ignores duplicate registration (idempotent)', () => {
      const { svc } = makeService();
      svc.register('jwt', 'first');
      svc.register('jwt', 'second'); // should be ignored
      expect(svc.get('jwt')).toBe('first');
    });

    it('sets up auto-rotation timer when intervalMs > 0', () => {
      jest.useFakeTimers();
      const { svc } = makeService();
      svc.register('api-key', 'initial', 1000);

      const before = svc.get('api-key');
      jest.advanceTimersByTime(1001);
      const after = svc.get('api-key');

      expect(after).not.toBe(before);
      svc.onModuleDestroy(); // clean up timer
    });

    it('does not auto-rotate when intervalMs is 0', () => {
      jest.useFakeTimers();
      const { svc } = makeService();
      svc.register('manual', 'static', 0);

      const before = svc.get('manual');
      jest.advanceTimersByTime(60_000);
      expect(svc.get('manual')).toBe(before);
    });
  });

  // ── rotate ────────────────────────────────────────────────────────────────

  describe('rotate()', () => {
    it('returns a new 64-char hex string', () => {
      const { svc } = makeService();
      svc.register('jwt', 'old');
      const newVal = svc.rotate('jwt');
      expect(newVal).toMatch(/^[0-9a-f]{64}$/);
    });

    it('updates the stored value', () => {
      const { svc } = makeService();
      svc.register('jwt', 'old');
      const newVal = svc.rotate('jwt');
      expect(svc.get('jwt')).toBe(newVal);
    });

    it('produces a different value on each rotation', () => {
      const { svc } = makeService();
      svc.register('jwt', 'old');
      const v1 = svc.rotate('jwt');
      const v2 = svc.rotate('jwt');
      expect(v1).not.toBe(v2);
    });

    it('updates lastRotatedAt', () => {
      const { svc } = makeService();
      svc.register('jwt', 'old');
      const before = svc.getRecord('jwt')!.lastRotatedAt;
      svc.rotate('jwt');
      const after = svc.getRecord('jwt')!.lastRotatedAt;
      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(
        new Date(before).getTime(),
      );
    });

    it('throws for an unknown secret name', () => {
      const { svc } = makeService();
      expect(() => svc.rotate('nonexistent')).toThrow(
        'Cannot rotate unknown secret "nonexistent"',
      );
    });

    it('emits SECRET_ROTATED_EVENT with name and rotatedAt (no value)', () => {
      const { svc, events } = makeService();
      svc.register('redis-pw', 'old');

      const received: SecretRotatedPayload[] = [];
      events.on(SECRET_ROTATED_EVENT, (p) => received.push(p));

      svc.rotate('redis-pw');

      expect(received).toHaveLength(1);
      expect(received[0].name).toBe('redis-pw');
      expect(received[0].rotatedAt).toBeDefined();
      // Secret value must NOT be in the event payload
      expect(received[0]).not.toHaveProperty('value');
    });
  });

  // ── get / getRecord ───────────────────────────────────────────────────────

  describe('get()', () => {
    it('returns undefined for an unregistered secret', () => {
      const { svc } = makeService();
      expect(svc.get('unknown')).toBeUndefined();
    });
  });

  describe('getRecord()', () => {
    it('returns metadata without the value field', () => {
      const { svc } = makeService();
      svc.register('db', 'secret-pw', 5000);
      const record = svc.getRecord('db');
      expect(record).toBeDefined();
      expect(record!.name).toBe('db');
      expect(record!.intervalMs).toBe(5000);
      expect(record).not.toHaveProperty('value');
    });

    it('returns undefined for an unregistered secret', () => {
      const { svc } = makeService();
      expect(svc.getRecord('missing')).toBeUndefined();
    });
  });

  // ── listNames ─────────────────────────────────────────────────────────────

  describe('listNames()', () => {
    it('returns all registered names', () => {
      const { svc } = makeService();
      svc.register('a', 'v1');
      svc.register('b', 'v2');
      expect(svc.listNames()).toEqual(expect.arrayContaining(['a', 'b']));
    });

    it('returns empty array when nothing is registered', () => {
      const { svc } = makeService();
      expect(svc.listNames()).toEqual([]);
    });
  });

  // ── onModuleDestroy ───────────────────────────────────────────────────────

  describe('onModuleDestroy()', () => {
    it('clears auto-rotation timers so they stop firing', () => {
      jest.useFakeTimers();
      const { svc } = makeService();
      svc.register('key', 'v', 500);

      svc.onModuleDestroy();

      const valueAfterDestroy = svc.get('key');
      jest.advanceTimersByTime(2000);
      // Value should not have changed after destroy
      expect(svc.get('key')).toBe(valueAfterDestroy);
    });
  });

  // ── security properties ───────────────────────────────────────────────────

  describe('security', () => {
    it('does not expose the secret value via getRecord()', () => {
      const { svc } = makeService();
      svc.register('jwt', 'super-secret');
      const record = svc.getRecord('jwt') as any;
      expect(record.value).toBeUndefined();
    });

    it('does not include the secret value in the rotation event', () => {
      const { svc, events } = makeService();
      svc.register('jwt', 'super-secret');
      const payloads: any[] = [];
      events.on(SECRET_ROTATED_EVENT, (p) => payloads.push(p));
      svc.rotate('jwt');
      expect(payloads[0].value).toBeUndefined();
    });
  });
});
