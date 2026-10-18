import { ExecutionContext, RequestTimeoutException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { delay, firstValueFrom, of } from 'rxjs';
import {
  RESOLVER_TIMEOUT_KEY,
  ResolverTimeoutInterceptor,
} from './resolver-timeout.interceptor';

function makeContext(fieldInfo: { parentType?: { name: string }; fieldName: string } | null = {
  parentType: { name: 'Query' },
  fieldName: 'topProviders',
}): ExecutionContext {
  return {
    getHandler: () => ({ name: 'topProviders' }),
    getClass: () => ({ name: 'ProviderResolver' }),
    getType: () => 'graphql',
    getArgs: () => [{}, {}, {}, { fieldName: fieldInfo?.fieldName, parentType: fieldInfo?.parentType }],
    getArgByIndex: (i: number) =>
      i === 3 ? { fieldName: fieldInfo?.fieldName, parentType: fieldInfo?.parentType } : {},
  } as unknown as ExecutionContext;
}

describe('ResolverTimeoutInterceptor (issue #1385)', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
      getInfo: () => ({ parentType: { name: 'Query' }, fieldName: 'topProviders' }),
    } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('passes through a resolver that completes within its budget', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(100);
    const interceptor = new ResolverTimeoutInterceptor(reflector);

    const result = await firstValueFrom(
      interceptor.intercept(makeContext(), { handle: () => of('ok') }),
    );

    expect(result).toBe('ok');
  });

  it('throws a RequestTimeoutException once the handler-level budget elapses', async () => {
    jest.spyOn(reflector, 'get').mockImplementation((key) =>
      key === RESOLVER_TIMEOUT_KEY ? 30 : undefined,
    );
    const interceptor = new ResolverTimeoutInterceptor(reflector);

    await expect(
      firstValueFrom(
        interceptor.intercept(makeContext(), {
          handle: () => of('too-slow').pipe(delay(200)),
        }),
      ),
    ).rejects.toThrow(RequestTimeoutException);
  });

  it('includes the offending field name in the timeout message', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(30);
    const interceptor = new ResolverTimeoutInterceptor(reflector);

    await expect(
      firstValueFrom(
        interceptor.intercept(makeContext(), {
          handle: () => of('too-slow').pipe(delay(200)),
        }),
      ),
    ).rejects.toThrow(/Query\.topProviders/);
  });

  it('falls back to GRAPHQL_RESOLVER_TIMEOUT_MS from config when no decorator is set', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);
    const configService = {
      get: jest.fn((key: string) => (key === 'GRAPHQL_RESOLVER_TIMEOUT_MS' ? 30 : undefined)),
    } as unknown as ConfigService;
    const interceptor = new ResolverTimeoutInterceptor(reflector, configService);

    await expect(
      firstValueFrom(
        interceptor.intercept(makeContext(), {
          handle: () => of('too-slow').pipe(delay(200)),
        }),
      ),
    ).rejects.toThrow(RequestTimeoutException);
  });

  it('falls back to the 5s default when neither a decorator nor config is set', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);
    const interceptor = new ResolverTimeoutInterceptor(reflector);

    const obs = interceptor.intercept(makeContext(), { handle: () => of('ok') });
    await expect(firstValueFrom(obs)).resolves.toBe('ok');
  });

  it('re-throws non-timeout errors unchanged', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(500);
    const interceptor = new ResolverTimeoutInterceptor(reflector);
    const boom = new Error('db error');

    await expect(
      firstValueFrom(
        interceptor.intercept(makeContext(), {
          handle: () => {
            throw boom;
          },
        }),
      ),
    ).rejects.toThrow('db error');
  });
});
