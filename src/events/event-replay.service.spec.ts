import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  EventReplayService,
  ReplayOptions,
  REPLAY_EVENT,
  REPLAY_COMPLETE_EVENT,
} from './event-replay.service';
import { AuditLog, AuditAction, AuditStatus } from '../audit-log/entities/audit-log.entity';

const mockAuditRepo = () => ({ find: jest.fn() });
const mockEmitter = () => ({ emit: jest.fn() });

const makeLog = (overrides: Partial<AuditLog> = {}): AuditLog =>
  ({
    id: 'log-1',
    userId: 'user-1',
    action: AuditAction.TRADE_EXECUTED,
    resource: 'trade',
    resourceId: 'trade-1',
    metadata: { amount: 100 },
    ipAddress: '127.0.0.1',
    userAgent: 'test',
    status: AuditStatus.SUCCESS,
    errorMessage: null,
    sessionId: 'sess-1',
    requestId: 'req-1',
    createdAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  } as AuditLog);

describe('EventReplayService', () => {
  let service: EventReplayService;
  let auditRepo: ReturnType<typeof mockAuditRepo>;
  let emitter: ReturnType<typeof mockEmitter>;

  const baseOptions: ReplayOptions = {
    from: new Date('2024-01-01'),
    to: new Date('2024-01-31'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventReplayService,
        { provide: getRepositoryToken(AuditLog), useFactory: mockAuditRepo },
        { provide: EventEmitter2, useFactory: mockEmitter },
      ],
    }).compile();

    service = module.get(EventReplayService);
    auditRepo = module.get(getRepositoryToken(AuditLog));
    emitter = module.get(EventEmitter2);
  });

  // ── validation ────────────────────────────────────────────────────────────

  describe('validation', () => {
    it('throws when from >= to', async () => {
      auditRepo.find.mockResolvedValue([]);
      await expect(
        service.replay({ from: new Date('2024-02-01'), to: new Date('2024-01-01') }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when window exceeds 90 days', async () => {
      await expect(
        service.replay({
          from: new Date('2024-01-01'),
          to: new Date('2024-05-01'), // ~120 days
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── dry-run ───────────────────────────────────────────────────────────────

  describe('dry-run', () => {
    it('does not emit REPLAY_EVENT in dry-run mode', async () => {
      auditRepo.find.mockResolvedValue([makeLog()]);

      const result = await service.replay({ ...baseOptions, dryRun: true });

      const replayEmitCalls = (emitter.emit as jest.Mock).mock.calls.filter(
        ([name]) => name === REPLAY_EVENT,
      );
      expect(replayEmitCalls).toHaveLength(0);
      expect(result.dryRun).toBe(true);
      expect(result.replayed).toBe(1);
    });

    it('still emits REPLAY_COMPLETE_EVENT in dry-run mode', async () => {
      auditRepo.find.mockResolvedValue([makeLog()]);
      await service.replay({ ...baseOptions, dryRun: true });

      expect(emitter.emit).toHaveBeenCalledWith(
        REPLAY_COMPLETE_EVENT,
        expect.objectContaining({ dryRun: true }),
      );
    });
  });

  // ── live replay ───────────────────────────────────────────────────────────

  describe('live replay', () => {
    it('emits REPLAY_EVENT for each event', async () => {
      auditRepo.find.mockResolvedValue([makeLog({ id: 'a' }), makeLog({ id: 'b' })]);

      const result = await service.replay({ ...baseOptions, throttleMs: 0 });

      const replayCalls = (emitter.emit as jest.Mock).mock.calls.filter(
        ([name]) => name === REPLAY_EVENT,
      );
      expect(replayCalls).toHaveLength(2);
      expect(result.replayed).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('marks emitted payload with __replay flag and sessionId', async () => {
      auditRepo.find.mockResolvedValue([makeLog()]);
      await service.replay({ ...baseOptions, throttleMs: 0 });

      const [, payload] = (emitter.emit as jest.Mock).mock.calls.find(
        ([name]) => name === REPLAY_EVENT,
      );
      expect(payload.__replay).toBe(true);
      expect(payload.__replaySessionId).toBeDefined();
    });

    it('redacts sensitive metadata fields', async () => {
      auditRepo.find.mockResolvedValue([
        makeLog({ metadata: { token: 'secret123', amount: 50 } }),
      ]);
      await service.replay({ ...baseOptions, throttleMs: 0 });

      const [, payload] = (emitter.emit as jest.Mock).mock.calls.find(
        ([name]) => name === REPLAY_EVENT,
      );
      expect(payload.metadata.token).toBe('[REDACTED]');
      expect(payload.metadata.amount).toBe(50);
    });

    it('records errors and continues replay on handler failure', async () => {
      auditRepo.find.mockResolvedValue([makeLog({ id: 'fail' }), makeLog({ id: 'ok' })]);

      // Make the first emit throw
      let callCount = 0;
      (emitter.emit as jest.Mock).mockImplementation((name) => {
        if (name === REPLAY_EVENT) {
          callCount++;
          if (callCount === 1) throw new Error('handler error');
        }
      });

      const result = await service.replay({ ...baseOptions, throttleMs: 0 });

      expect(result.errors).toHaveLength(1);
      expect(result.skipped).toBe(1);
      expect(result.replayed).toBe(1);
    });
  });

  // ── preview ───────────────────────────────────────────────────────────────

  describe('preview', () => {
    it('returns events without emitting', async () => {
      const logs = [makeLog({ id: 'p1' }), makeLog({ id: 'p2' })];
      auditRepo.find.mockResolvedValue(logs);

      const result = await service.preview(baseOptions);

      expect(result).toHaveLength(2);
      expect(emitter.emit).not.toHaveBeenCalled();
    });
  });
});
