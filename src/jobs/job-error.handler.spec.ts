import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JobErrorHandler, JOB_ALERT_EVENT } from './job-error.handler';
import { DeadLetterService } from './dead-letter.service';

const makeJob = (overrides: Partial<{ id: string; attemptsMade: number; queueName: string; data: unknown }> = {}) => ({
  id: overrides.id ?? 'job-1',
  attemptsMade: overrides.attemptsMade ?? 3,
  data: overrides.data ?? { userId: 'u1' },
  queue: { name: overrides.queueName ?? 'trades-queue' },
});

async function buildHandler() {
  const dlqMock = { capture: jest.fn().mockResolvedValue(undefined) };
  const emitterMock = { emit: jest.fn() };

  const module = await Test.createTestingModule({
    providers: [
      JobErrorHandler,
      { provide: DeadLetterService, useValue: dlqMock },
      { provide: EventEmitter2, useValue: emitterMock },
    ],
  }).compile();

  return {
    handler: module.get(JobErrorHandler),
    dlq: dlqMock,
    emitter: emitterMock,
  };
}

describe('JobErrorHandler', () => {
  describe('handle()', () => {
    it('captures to DLQ and emits alert when attempts are exhausted', async () => {
      const { handler, dlq, emitter } = await buildHandler();
      const job = makeJob({ attemptsMade: 5 });
      await handler.handle(job as any, new Error('timeout'), 5);

      expect(dlq.capture).toHaveBeenCalledWith(job, expect.any(Error));
      expect(emitter.emit).toHaveBeenCalledWith(
        JOB_ALERT_EVENT,
        expect.objectContaining({ jobId: 'job-1', isFatal: false }),
      );
    });

    it('captures to DLQ and emits alert for fatal errors regardless of attempts', async () => {
      const { handler, dlq, emitter } = await buildHandler();
      const job = makeJob({ attemptsMade: 1 });
      await handler.handle(job as any, new Error('Unauthorized access'), 5);

      expect(dlq.capture).toHaveBeenCalled();
      expect(emitter.emit).toHaveBeenCalledWith(
        JOB_ALERT_EVENT,
        expect.objectContaining({ isFatal: true }),
      );
    });

    it('does NOT capture to DLQ when retries remain and error is not fatal', async () => {
      const { handler, dlq } = await buildHandler();
      const job = makeJob({ attemptsMade: 2 });
      await handler.handle(job as any, new Error('network error'), 5);

      expect(dlq.capture).not.toHaveBeenCalled();
    });
  });

  describe('isFatalError()', () => {
    it.each([
      ['Unauthorized request', true],
      ['Forbidden resource', true],
      ['Not found', true],
      ['Validation failed: amount', true],
      ['Invalid input provided', true],
      ['Connection timeout', false],
      ['Internal server error', false],
    ])('"%s" → fatal=%s', async (msg, expected) => {
      const { handler } = await buildHandler();
      expect(handler.isFatalError(new Error(msg))).toBe(expected);
    });
  });

  describe('redactSensitiveData()', () => {
    it('redacts known sensitive fields', async () => {
      const { handler } = await buildHandler();
      const result = handler.redactSensitiveData({
        userId: 'u1',
        password: 'secret123',
        apiKey: 'key-abc',
        amount: 100,
      });
      expect(result.userId).toBe('u1');
      expect(result.amount).toBe(100);
      expect(result.password).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
    });

    it('does not mutate the original object', async () => {
      const { handler } = await buildHandler();
      const original = { token: 'tok', value: 1 };
      handler.redactSensitiveData(original);
      expect(original.token).toBe('tok');
    });
  });

  describe('retryOptions()', () => {
    it('returns correct attempts and exponential backoff', () => {
      const opts = JobErrorHandler.retryOptions(4, 1000);
      expect(opts.attempts).toBe(4);
      expect(opts.backoff).toEqual({ type: 'exponential', delay: 1000 });
    });

    it('uses safe defaults', () => {
      const opts = JobErrorHandler.retryOptions();
      expect(opts.attempts).toBe(5);
      expect(opts.backoff.delay).toBe(2_000);
    });
  });
});
