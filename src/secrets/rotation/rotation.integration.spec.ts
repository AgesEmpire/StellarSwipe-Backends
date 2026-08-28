import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { CredentialOverlapService } from './credential-overlap.service';
import { RotationEventService, ROTATION_LIFECYCLE_EVENT } from './rotation-event.service';
import { RotationEventPayload } from './rotation.types';

describe('Secret Rotation Integration', () => {
  let overlapService: CredentialOverlapService;
  let rotationEventService: RotationEventService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [CredentialOverlapService, RotationEventService],
    }).compile();

    overlapService = module.get(CredentialOverlapService);
    rotationEventService = module.get(RotationEventService);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    overlapService.onModuleDestroy();
  });

  describe('full rotation lifecycle', () => {
    it('should rotate a credential with overlap window and emit lifecycle events', async () => {
      const events: RotationEventPayload[] = [];
      eventEmitter.on(ROTATION_LIFECYCLE_EVENT, (p: RotationEventPayload) => events.push(p));

      const secretName = 'jwt.secret';
      const oldValue = 'old-jwt-secret-value';
      const newValue = 'new-jwt-secret-value';

      // 1. Register
      overlapService.register(secretName, oldValue, { overlapWindowMs: 500 });

      // 2. Emit started
      rotationEventService.emitStarted(secretName);

      // 3. Rotate — old value moves to overlap
      overlapService.rotate(secretName, newValue);
      rotationEventService.emitOverlapActive(secretName, 'Overlap window: 500ms');

      // 4. Verify both old and new are valid during overlap
      expect(overlapService.validate(secretName, newValue)).toBe(true);
      expect(overlapService.validate(secretName, oldValue)).toBe(true);
      expect(overlapService.isOverlapActive(secretName)).toBe(true);
      expect(overlapService.getCurrent(secretName)).toBe(newValue);

      // 5. Wait for overlap window to expire
      await new Promise((resolve) => setTimeout(resolve, 600));

      // 6. Old value should no longer be valid
      expect(overlapService.validate(secretName, oldValue)).toBe(false);
      expect(overlapService.validate(secretName, newValue)).toBe(true);
      expect(overlapService.isOverlapActive(secretName)).toBe(false);

      rotationEventService.emitOverlapExpired(secretName);
      rotationEventService.emitCompleted(secretName);

      // 7. Verify events were emitted in order
      expect(events.length).toBe(4);
      expect(events.map((e) => e.phase)).toEqual([
        'started',
        'overlap-active',
        'overlap-expired',
        'completed',
      ]);
    });

    it('should reject unknown credentials', () => {
      expect(() => overlapService.rotate('unknown', 'value')).toThrow(
        'Credential "unknown" is not registered',
      );
    });

    it('should respect maxPreviousCredentials', () => {
      overlapService.register('test.key', 'v1', {
        overlapWindowMs: 60_000,
        maxPreviousCredentials: 2,
      });

      overlapService.rotate('test.key', 'v2');
      overlapService.rotate('test.key', 'v3');
      overlapService.rotate('test.key', 'v4');

      // v1 was evicted (max 2 previous)
      expect(overlapService.validate('test.key', 'v1')).toBe(false);
      // v2 and v3 are still in overlap, v4 is current
      expect(overlapService.validate('test.key', 'v2')).toBe(true);
      expect(overlapService.validate('test.key', 'v3')).toBe(true);
      expect(overlapService.validate('test.key', 'v4')).toBe(true);
    });

    it('should emit failed event on rotation error', () => {
      const events: RotationEventPayload[] = [];
      eventEmitter.on(ROTATION_LIFECYCLE_EVENT, (p: RotationEventPayload) => events.push(p));

      rotationEventService.emitFailed('db.password', 'Connection refused to vault');

      expect(events.length).toBe(1);
      expect(events[0].phase).toBe('failed');
      expect(events[0].detail).toContain('Connection refused');
    });

    it('should provide state without exposing credential values', () => {
      overlapService.register('encryption.key', 'secret-value');

      const state = overlapService.getState('encryption.key');
      expect(state).toBeDefined();
      expect(state!.policy.name).toBe('encryption.key');
      expect(state!.overlapActive).toBe(false);
      // No 'current' or 'previous' fields with actual values
      expect((state as any).current).toBeUndefined();
      expect((state as any).previous).toBeUndefined();
    });
  });
});
