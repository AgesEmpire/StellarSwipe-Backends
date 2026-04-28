import { Reflector } from '@nestjs/core';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { DeprecationInterceptor } from './deprecation.interceptor';
import { DEPRECATED_KEY, DEPRECATION_METADATA_KEY } from '../decorators/deprecated.decorator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildContext(isDeprecated: boolean, options?: any): ExecutionContext {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: jest.fn((k: string, v: string) => { headers[k] = v; }),
    _headers: headers,
  };

  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => {
    if (key === DEPRECATED_KEY) return isDeprecated;
    if (key === DEPRECATION_METADATA_KEY) return options;
    return undefined;
  });

  const ctx = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getResponse: jest.fn().mockReturnValue(res),
    }),
  } as unknown as ExecutionContext;

  return ctx;
}

function buildHandler(): CallHandler {
  return { handle: jest.fn().mockReturnValue(of({})) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeprecationInterceptor', () => {
  let reflector: Reflector;
  let interceptor: DeprecationInterceptor;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new DeprecationInterceptor(reflector);
  });

  it('sets Deprecation header when endpoint is deprecated', (done) => {
    const ctx = buildContext(true, { sunsetDate: '2025-12-31', successorVersion: '2' });
    const handler = buildHandler();

    interceptor.intercept(ctx, handler).subscribe(() => {
      const res = ctx.switchToHttp().getResponse() as any;
      expect(res.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
      done();
    });
  });

  it('sets Sunset header when sunsetDate is provided', (done) => {
    const ctx = buildContext(true, { sunsetDate: '2025-12-31' });
    const handler = buildHandler();

    interceptor.intercept(ctx, handler).subscribe(() => {
      const res = ctx.switchToHttp().getResponse() as any;
      expect(res.setHeader).toHaveBeenCalledWith('Sunset', '2025-12-31');
      done();
    });
  });

  it('sets Link header when successorVersion is provided', (done) => {
    const ctx = buildContext(true, { successorVersion: '2' });
    const handler = buildHandler();

    interceptor.intercept(ctx, handler).subscribe(() => {
      const res = ctx.switchToHttp().getResponse() as any;
      expect(res.setHeader).toHaveBeenCalledWith(
        'Link',
        '</api/v2>; rel="successor-version"',
      );
      done();
    });
  });

  it('sets X-Deprecation-Notice header with reason when provided', (done) => {
    const ctx = buildContext(true, {
      sunsetDate: '2025-12-31',
      successorVersion: '2',
      reason: 'Use the new endpoint.',
    });
    const handler = buildHandler();

    interceptor.intercept(ctx, handler).subscribe(() => {
      const res = ctx.switchToHttp().getResponse() as any;
      const noticeCalls = (res.setHeader as jest.Mock).mock.calls.find(
        (c: any[]) => c[0] === 'X-Deprecation-Notice',
      );
      expect(noticeCalls).toBeDefined();
      expect(noticeCalls[1]).toContain('Use the new endpoint.');
      done();
    });
  });

  it('does NOT set any deprecation headers when endpoint is not deprecated', (done) => {
    const ctx = buildContext(false);
    const handler = buildHandler();

    interceptor.intercept(ctx, handler).subscribe(() => {
      const res = ctx.switchToHttp().getResponse() as any;
      expect(res.setHeader).not.toHaveBeenCalled();
      done();
    });
  });

  it('still calls next.handle() and passes through the response', (done) => {
    const ctx = buildContext(true, { sunsetDate: '2025-12-31' });
    const handler = buildHandler();

    interceptor.intercept(ctx, handler).subscribe((value) => {
      expect(value).toEqual({});
      expect(handler.handle).toHaveBeenCalled();
      done();
    });
  });

  it('does not set Sunset header when sunsetDate is absent', (done) => {
    const ctx = buildContext(true, { successorVersion: '2' });
    const handler = buildHandler();

    interceptor.intercept(ctx, handler).subscribe(() => {
      const res = ctx.switchToHttp().getResponse() as any;
      const sunsetCall = (res.setHeader as jest.Mock).mock.calls.find(
        (c: any[]) => c[0] === 'Sunset',
      );
      expect(sunsetCall).toBeUndefined();
      done();
    });
  });
});
