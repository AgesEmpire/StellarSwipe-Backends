import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, firstValueFrom } from 'rxjs';
import { CorrelationIdInterceptor } from './correlation-id.interceptor';
import {
  CorrelationIdStore,
  CORRELATION_ID_HEADER,
} from '../correlation/correlation-id.store';

jest.mock('uuid', () => ({ v4: () => 'generated-uuid-v4' }));

function buildHttpContext(
  overrides: {
    headers?: Record<string, string>;
    path?: string;
    method?: string;
    user?: { id: string };
  } = {},
): { context: ExecutionContext; response: { setHeader: jest.Mock } } {
  const response = { setHeader: jest.fn() };
  const request: any = {
    headers: { ...(overrides.headers ?? {}) },
    path: overrides.path ?? '/api/v1/test',
    method: overrides.method ?? 'GET',
    ...(overrides.user ? { user: overrides.user } : {}),
  };
  const context: ExecutionContext = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as any;
  return { context, response };
}

function buildCallHandler(returnValue: unknown = {}): CallHandler {
  return { handle: () => of(returnValue) };
}

describe('CorrelationIdInterceptor', () => {
  let interceptor: CorrelationIdInterceptor;
  let store: CorrelationIdStore;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CorrelationIdInterceptor, CorrelationIdStore],
    }).compile();

    interceptor = module.get<CorrelationIdInterceptor>(CorrelationIdInterceptor);
    store = module.get<CorrelationIdStore>(CorrelationIdStore);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Response header
  // ──────────────────────────────────────────────────────────────────────────

  describe('response header', () => {
    it('echoes the correlation ID from the store onto the response header', async () => {
      const { context, response } = buildHttpContext();

      await store.run({ correlationId: 'store-id' }, async () => {
        await firstValueFrom(
          interceptor.intercept(context, buildCallHandler()),
        );
      });

      expect(response.setHeader).toHaveBeenCalledWith(
        CORRELATION_ID_HEADER,
        'store-id',
      );
    });

    it('falls back to the incoming request header when no store context is active', async () => {
      const { context, response } = buildHttpContext({
        headers: { [CORRELATION_ID_HEADER]: 'request-header-id' },
      });

      // Deliberately no store.run() wrapper — simulates standalone usage
      await firstValueFrom(interceptor.intercept(context, buildCallHandler()));

      expect(response.setHeader).toHaveBeenCalledWith(
        CORRELATION_ID_HEADER,
        'request-header-id',
      );
    });

    it('generates a fresh UUID when neither store nor request header supply an ID', async () => {
      const { context, response } = buildHttpContext();

      await firstValueFrom(interceptor.intercept(context, buildCallHandler()));

      expect(response.setHeader).toHaveBeenCalledWith(
        CORRELATION_ID_HEADER,
        'generated-uuid-v4',
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Async task metadata (CorrelationIdStore)
  // ──────────────────────────────────────────────────────────────────────────

  describe('async context propagation', () => {
    it('seeds the store when no context is active, making the ID readable downstream', async () => {
      const { context } = buildHttpContext({
        headers: { [CORRELATION_ID_HEADER]: 'header-id' },
      });

      let observedId: string | undefined;

      const handler: CallHandler = {
        handle: () => {
          observedId = store.getCorrelationId();
          return of(null);
        },
      };

      await firstValueFrom(interceptor.intercept(context, handler));

      expect(observedId).toBe('header-id');
    });

    it('does not override an existing store context when one is already active', async () => {
      const { context } = buildHttpContext({
        headers: { [CORRELATION_ID_HEADER]: 'would-override' },
      });

      let observedId: string | undefined;

      const handler: CallHandler = {
        handle: () => {
          observedId = store.getCorrelationId();
          return of(null);
        },
      };

      await store.run({ correlationId: 'existing-context-id' }, async () => {
        await firstValueFrom(interceptor.intercept(context, handler));
      });

      // The pre-existing context ID should win
      expect(observedId).toBe('existing-context-id');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Header priority
  // ──────────────────────────────────────────────────────────────────────────

  describe('ID priority', () => {
    it('prefers the store context ID over the incoming header', async () => {
      const { context, response } = buildHttpContext({
        headers: { [CORRELATION_ID_HEADER]: 'incoming-header' },
      });

      await store.run({ correlationId: 'store-wins' }, async () => {
        await firstValueFrom(
          interceptor.intercept(context, buildCallHandler()),
        );
      });

      expect(response.setHeader).toHaveBeenCalledWith(
        CORRELATION_ID_HEADER,
        'store-wins',
      );
    });

    it('prefers the incoming header over a generated UUID', async () => {
      const { context, response } = buildHttpContext({
        headers: { [CORRELATION_ID_HEADER]: 'propagated-id' },
      });

      await firstValueFrom(interceptor.intercept(context, buildCallHandler()));

      expect(response.setHeader).toHaveBeenCalledWith(
        CORRELATION_ID_HEADER,
        'propagated-id',
      );
      // uuid mock should not have been used as the actual ID
      expect(response.setHeader).not.toHaveBeenCalledWith(
        CORRELATION_ID_HEADER,
        'generated-uuid-v4',
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Non-HTTP contexts
  // ──────────────────────────────────────────────────────────────────────────

  describe('non-HTTP contexts', () => {
    it('passes through without touching headers for WebSocket context', async () => {
      const response = { setHeader: jest.fn() };
      const context: ExecutionContext = {
        getType: () => 'ws',
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
          getResponse: () => response,
        }),
      } as any;

      await firstValueFrom(interceptor.intercept(context, buildCallHandler()));

      expect(response.setHeader).not.toHaveBeenCalled();
    });

    it('passes through without touching headers for RPC context', async () => {
      const response = { setHeader: jest.fn() };
      const context: ExecutionContext = {
        getType: () => 'rpc',
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
          getResponse: () => response,
        }),
      } as any;

      await firstValueFrom(interceptor.intercept(context, buildCallHandler()));

      expect(response.setHeader).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Passthrough
  // ──────────────────────────────────────────────────────────────────────────

  describe('passthrough', () => {
    it('forwards the response data unchanged', async () => {
      const { context } = buildHttpContext();
      const payload = { id: 1, name: 'Stellar' };

      const result = await store.run(
        { correlationId: 'pass-through-id' },
        () =>
          firstValueFrom(interceptor.intercept(context, buildCallHandler(payload))),
      );

      expect(result).toEqual(payload);
    });
  });
});
