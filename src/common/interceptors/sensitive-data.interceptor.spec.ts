import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { SensitiveDataInterceptor } from './sensitive-data.interceptor';
import { EXPOSE_SENSITIVE_FIELDS_KEY } from '../decorators/expose-sensitive-fields.decorator';

function buildContext(): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function buildHandler(data: unknown): CallHandler {
  return { handle: () => of(data) };
}

async function run(
  interceptor: SensitiveDataInterceptor,
  data: unknown,
  ctx: ExecutionContext = buildContext(),
): Promise<any> {
  const result$ = interceptor.intercept(ctx, buildHandler(data));
  return new Promise((resolve) => {
    result$.subscribe((value) => resolve(value));
  });
}

describe('SensitiveDataInterceptor', () => {
  describe('default (public) exposure', () => {
    let interceptor: SensitiveDataInterceptor;

    beforeEach(() => {
      // No Reflector supplied -> always treated as public/non-internal.
      interceptor = new SensitiveDataInterceptor();
    });

    it('redacts well-known sensitive field names by default', async () => {
      const result = await run(interceptor, {
        id: 'user-1',
        ssn: '123-45-6789',
        secret: 'top-secret',
      });

      expect(result.ssn).toBe('[REDACTED]');
      expect(result.secret).toBe('[REDACTED]');
      expect(result.id).toBe('user-1');
    });

    it('partially masks PII fields, preserving the last 4 characters', async () => {
      const result = await run(interceptor, { accountNumber: '000111222333' });

      expect(result.accountNumber).toBe('****2333');
    });

    it('leaves non-sensitive fields untouched', async () => {
      const result = await run(interceptor, {
        id: 'trade-1',
        symbol: 'XLM/USD',
        amount: 100,
      });

      expect(result).toEqual({ id: 'trade-1', symbol: 'XLM/USD', amount: 100 });
    });

    it('redacts sensitive fields inside nested objects and arrays', async () => {
      const result = await run(interceptor, {
        users: [
          { id: 'u1', apiKey: 'sk_live_abc123' },
          { id: 'u2', apiKey: 'sk_live_def456' },
        ],
      });

      expect(result.users[0].apiKey).toBe('[REDACTED]');
      expect(result.users[1].apiKey).toBe('[REDACTED]');
      expect(result.users[0].id).toBe('u1');
    });

    it('strips fields that look like AES-256-GCM ciphertext regardless of key name', async () => {
      const ivHex = 'a'.repeat(24);
      const authTagHex = 'b'.repeat(32);
      const ciphertext = `${ivHex}:${authTagHex}:deadbeef`;

      const result = await run(interceptor, { notes: ciphertext, id: 'x' });

      expect(result.notes).toBeUndefined();
      expect(result.id).toBe('x');
    });
  });

  describe('internal exposure via @ExposeSensitiveFields()', () => {
    it('skips field-name redaction when the route is marked internal', async () => {
      const reflector = {
        getAllAndOverride: jest.fn((key: string) =>
          key === EXPOSE_SENSITIVE_FIELDS_KEY ? true : undefined,
        ),
      };
      const interceptor = new SensitiveDataInterceptor(reflector as any);

      const result = await run(interceptor, {
        ssn: '123-45-6789',
        secret: 'top-secret',
      });

      expect(result.ssn).toBe('123-45-6789');
      expect(result.secret).toBe('top-secret');
    });

    it('still strips ciphertext-shaped values even when marked internal', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(true),
      };
      const interceptor = new SensitiveDataInterceptor(reflector as any);
      const ivHex = 'c'.repeat(24);
      const authTagHex = 'd'.repeat(32);
      const ciphertext = `${ivHex}:${authTagHex}:cafebabe`;

      const result = await run(interceptor, { blob: ciphertext });

      expect(result.blob).toBeUndefined();
    });

    it('redacts by default when the route has no metadata (fail-closed)', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(undefined),
      };
      const interceptor = new SensitiveDataInterceptor(reflector as any);

      const result = await run(interceptor, { ssn: '123-45-6789' });

      expect(result.ssn).toBe('[REDACTED]');
    });
  });
});
