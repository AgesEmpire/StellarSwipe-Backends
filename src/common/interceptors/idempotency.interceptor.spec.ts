import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
} from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';

function makeContext(
  method: string,
  headers: Record<string, unknown> = {},
  url = '/trades/execute',
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, headers, originalUrl: url }),
    }),
  } as unknown as ExecutionContext;
}

describe('IdempotencyInterceptor', () => {
  it('executes the first request and caches its response', async () => {
    const interceptor = new IdempotencyInterceptor();
    const handler: CallHandler = { handle: jest.fn(() => of({ id: 1 })) };
    const ctx = makeContext('POST', { 'idempotency-key': 'abc' });

    const result = await firstValueFrom(interceptor.intercept(ctx, handler));

    expect(result).toEqual({ id: 1 });
    expect(handler.handle).toHaveBeenCalledTimes(1);
  });

  it('returns the cached response on repeat without re-running the handler', async () => {
    const interceptor = new IdempotencyInterceptor();
    const handler: CallHandler = { handle: jest.fn(() => of({ id: 1 })) };

    const first = await firstValueFrom(
      interceptor.intercept(
        makeContext('POST', { 'idempotency-key': 'abc' }),
        handler,
      ),
    );
    const second = await firstValueFrom(
      interceptor.intercept(
        makeContext('POST', { 'idempotency-key': 'abc' }),
        handler,
      ),
    );

    expect(first).toEqual(second);
    expect(handler.handle).toHaveBeenCalledTimes(1);
  });

  it('serialises concurrent requests with the same key to a single execution', async () => {
    const interceptor = new IdempotencyInterceptor();
    let executions = 0;
    const handler: CallHandler = {
      handle: jest.fn(() => {
        executions += 1;
        return of({ execution: executions });
      }),
    };

    const [a, b] = await Promise.all([
      firstValueFrom(
        interceptor.intercept(
          makeContext('POST', { 'idempotency-key': 'dup' }),
          handler,
        ),
      ),
      firstValueFrom(
        interceptor.intercept(
          makeContext('POST', { 'idempotency-key': 'dup' }),
          handler,
        ),
      ),
    ]);

    expect(executions).toBe(1);
    expect(a).toEqual(b);
  });

  it('bypasses caching for non-mutating methods', async () => {
    const interceptor = new IdempotencyInterceptor();
    const handler: CallHandler = { handle: jest.fn(() => of('ok')) };

    await firstValueFrom(
      interceptor.intercept(
        makeContext('GET', { 'idempotency-key': 'abc' }),
        handler,
      ),
    );
    await firstValueFrom(
      interceptor.intercept(
        makeContext('GET', { 'idempotency-key': 'abc' }),
        handler,
      ),
    );

    expect(handler.handle).toHaveBeenCalledTimes(2);
  });

  it('proceeds normally when no Idempotency-Key header is present', async () => {
    const interceptor = new IdempotencyInterceptor();
    const handler: CallHandler = { handle: jest.fn(() => of('ok')) };

    const result = await firstValueFrom(
      interceptor.intercept(makeContext('POST', {}), handler),
    );

    expect(result).toBe('ok');
  });

  it('rejects an empty Idempotency-Key header', () => {
    const interceptor = new IdempotencyInterceptor();
    const handler: CallHandler = { handle: jest.fn(() => of('ok')) };

    expect(() =>
      interceptor.intercept(
        makeContext('POST', { 'idempotency-key': '   ' }),
        handler,
      ),
    ).toThrow(BadRequestException);
  });

  it('re-executes once a cached entry has expired', async () => {
    const interceptor = new IdempotencyInterceptor(-1); // already expired
    const handler: CallHandler = { handle: jest.fn(() => of({ id: 1 })) };

    await firstValueFrom(
      interceptor.intercept(
        makeContext('POST', { 'idempotency-key': 'abc' }),
        handler,
      ),
    );
    await firstValueFrom(
      interceptor.intercept(
        makeContext('POST', { 'idempotency-key': 'abc' }),
        handler,
      ),
    );

    expect(handler.handle).toHaveBeenCalledTimes(2);
  });
});
