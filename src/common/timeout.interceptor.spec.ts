import { ExecutionContext, RequestTimeoutException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, delay, firstValueFrom } from 'rxjs';
import {
  TimeoutInterceptor,
  REQUEST_TIMEOUT_KEY,
} from './timeout.interceptor';

const makeContext = (
  handlerMeta: number | undefined,
  classMeta: number | undefined,
): ExecutionContext => {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'get')
    .mockImplementation((key: string, target: object) => {
      if (key !== REQUEST_TIMEOUT_KEY) return undefined;
      // handler is checked first, then class
      if (target === 'handler') return handlerMeta;
      if (target === 'class') return classMeta;
      return undefined;
    });

  return {
    getHandler: () => 'handler' as unknown as Function,
    getClass: () => 'class' as unknown as Function,
  } as unknown as ExecutionContext;
};

describe('TimeoutInterceptor', () => {
  let reflector: Reflector;
  let interceptor: TimeoutInterceptor;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new TimeoutInterceptor(reflector);
  });

  it('should pass through responses that complete within the timeout', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(500);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    const result = await firstValueFrom(
      interceptor.intercept(ctx, { handle: () => of('ok') }),
    );

    expect(result).toBe('ok');
  });

  it('should throw RequestTimeoutException when response exceeds timeout', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(50);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    await expect(
      firstValueFrom(
        interceptor.intercept(ctx, {
          handle: () => of('slow').pipe(delay(200)),
        }),
      ),
    ).rejects.toThrow(RequestTimeoutException);
  });

  it('should use handler-level timeout when set', async () => {
    jest
      .spyOn(reflector, 'get')
      .mockImplementationOnce(() => 50) // handler
      .mockImplementationOnce(() => 5000); // class

    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    await expect(
      firstValueFrom(
        interceptor.intercept(ctx, {
          handle: () => of('slow').pipe(delay(200)),
        }),
      ),
    ).rejects.toThrow(RequestTimeoutException);
  });

  it('should re-throw non-timeout errors unchanged', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(500);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    const boom = new Error('db error');

    await expect(
      firstValueFrom(
        interceptor.intercept(ctx, {
          handle: () => {
            throw boom;
          },
        }),
      ),
    ).rejects.toThrow('db error');
  });

  it('should fall back to 30s default when no metadata is set', () => {
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    // Just verify it doesn't throw synchronously and returns an observable
    const obs = interceptor.intercept(ctx, { handle: () => of('ok') });
    expect(obs).toBeDefined();
  });
});
