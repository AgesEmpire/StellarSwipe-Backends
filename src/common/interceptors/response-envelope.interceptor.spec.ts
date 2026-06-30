import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';

function makeContext(overrides: { skipEnvelope?: boolean } = {}): ExecutionContext {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(overrides.skipEnvelope ?? false);
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn(),
  } as unknown as ExecutionContext;
}

function makeHandler(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('ResponseEnvelopeInterceptor', () => {
  let reflector: Reflector;
  let interceptor: ResponseEnvelopeInterceptor;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new ResponseEnvelopeInterceptor(reflector);
  });

  it('wraps a plain object in { data, meta }', (done) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeContext();
    const result$ = interceptor.intercept(ctx, makeHandler({ id: '1', name: 'test' }));

    result$.subscribe((envelope) => {
      expect(envelope.data).toEqual({ id: '1', name: 'test' });
      expect(envelope.meta).toMatchObject({ timestamp: expect.any(String) });
      done();
    });
  });

  it('wraps an array in { data, meta }', (done) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeContext();
    const result$ = interceptor.intercept(ctx, makeHandler([{ id: '1' }, { id: '2' }]));

    result$.subscribe((envelope) => {
      expect(envelope.data).toEqual([{ id: '1' }, { id: '2' }]);
      expect(envelope.meta.timestamp).toBeDefined();
      done();
    });
  });

  it('hoists pagination fields into meta for paginated responses', (done) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeContext();
    const paginated = {
      signals: [{ id: 'a' }],
      page: 2,
      totalPages: 5,
      hasMore: true,
      nextCursor: 'abc123',
    };

    const result$ = interceptor.intercept(ctx, makeHandler(paginated));

    result$.subscribe((envelope) => {
      expect((envelope.data as any).signals).toEqual([{ id: 'a' }]);
      expect(envelope.meta.page).toBe(2);
      expect(envelope.meta.totalPages).toBe(5);
      expect(envelope.meta.hasMore).toBe(true);
      expect(envelope.meta.nextCursor).toBe('abc123');
      expect((envelope.data as any).page).toBeUndefined();
      done();
    });
  });

  it('hoists pagination object from PaginationInterceptor format', (done) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeContext();
    const payload = {
      data: [{ id: '1' }],
      pagination: { page: 1, limit: 20, total: 100, totalPages: 5, hasNext: true, hasPrev: false },
    };

    const result$ = interceptor.intercept(ctx, makeHandler(payload));

    result$.subscribe((envelope) => {
      expect((envelope.data as any).data).toEqual([{ id: '1' }]);
      expect(envelope.meta.pagination).toBeDefined();
      done();
    });
  });

  it('passes through without wrapping when @SkipEnvelope is set', (done) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = makeContext({ skipEnvelope: true });
    const raw = { file: 'binary-data' };

    const result$ = interceptor.intercept(ctx, makeHandler(raw));

    result$.subscribe((value) => {
      expect(value).toEqual(raw);
      expect((value as any).data).toBeUndefined();
      done();
    });
  });

  it('meta.timestamp is a valid ISO string', (done) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeContext();

    interceptor.intercept(ctx, makeHandler({})).subscribe((envelope) => {
      expect(new Date(envelope.meta.timestamp).toISOString()).toBe(envelope.meta.timestamp);
      done();
    });
  });

  it('reflector is called with SKIP_ENVELOPE_KEY', () => {
    const spy = jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeContext();
    interceptor.intercept(ctx, makeHandler({})).subscribe();

    expect(spy).toHaveBeenCalledWith(SKIP_ENVELOPE_KEY, expect.any(Array));
  });
});
