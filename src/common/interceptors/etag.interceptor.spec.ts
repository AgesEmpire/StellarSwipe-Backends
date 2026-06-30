import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, EMPTY } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { ServerResponse } from 'http';
import { ETagInterceptor } from './etag.interceptor';

function makeMockResponse(): ServerResponse & {
  headers: Record<string, string>;
  statusCode: number;
  ended: boolean;
} {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let ended = false;

  return {
    headers,
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
    get ended() { return ended; },
    setHeader(name: string, value: string) { headers[name] = value; },
    end() { ended = true; },
  } as any;
}

function makeContext(ifNoneMatch?: string): { ctx: ExecutionContext; response: ReturnType<typeof makeMockResponse> } {
  const response = makeMockResponse();
  const request = { headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {} };
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: jest.fn(),
    getClass: jest.fn(),
  } as unknown as ExecutionContext;
  return { ctx, response };
}

function makeHandler(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('ETagInterceptor', () => {
  let interceptor: ETagInterceptor;

  beforeEach(() => {
    interceptor = new ETagInterceptor();
  });

  it('sets ETag header on a 200 response', (done) => {
    const { ctx, response } = makeContext();

    interceptor.intercept(ctx, makeHandler({ signals: [{ id: '1' }] })).subscribe(() => {
      expect(response.headers['ETag']).toMatch(/^"[a-f0-9]{32}"$/);
      done();
    });
  });

  it('sets Cache-Control header', (done) => {
    const { ctx, response } = makeContext();

    interceptor.intercept(ctx, makeHandler({ id: '1' })).subscribe(() => {
      expect(response.headers['Cache-Control']).toBe('no-cache');
      done();
    });
  });

  it('returns the data payload when If-None-Match does not match', (done) => {
    const { ctx } = makeContext('"stale-etag"');
    const data = { signals: [{ id: '42' }] };

    interceptor.intercept(ctx, makeHandler(data)).subscribe((result) => {
      expect(result).toEqual(data);
      done();
    });
  });

  it('returns 304 and completes with EMPTY when If-None-Match matches', (done) => {
    const data = { signals: [{ id: '1' }] };
    const json = JSON.stringify(data);
    const crypto = require('crypto');
    const etag = `"${crypto.createHash('md5').update(json).digest('hex')}"`;

    const { ctx, response } = makeContext(etag);

    interceptor
      .intercept(ctx, makeHandler(data))
      .pipe(toArray())
      .subscribe((emitted) => {
        expect(emitted).toHaveLength(0);
        expect(response.statusCode).toBe(304);
        expect(response.ended).toBe(true);
        done();
      });
  });

  it('produces consistent ETags for identical payloads', (done) => {
    const data = { a: 1 };
    const { ctx: ctx1, response: r1 } = makeContext();
    const { ctx: ctx2, response: r2 } = makeContext();

    interceptor.intercept(ctx1, makeHandler(data)).subscribe(() => {
      interceptor.intercept(ctx2, makeHandler(data)).subscribe(() => {
        expect(r1.headers['ETag']).toBe(r2.headers['ETag']);
        done();
      });
    });
  });

  it('produces different ETags for different payloads', (done) => {
    const { ctx: ctx1, response: r1 } = makeContext();
    const { ctx: ctx2, response: r2 } = makeContext();

    interceptor.intercept(ctx1, makeHandler({ a: 1 })).subscribe(() => {
      interceptor.intercept(ctx2, makeHandler({ a: 2 })).subscribe(() => {
        expect(r1.headers['ETag']).not.toBe(r2.headers['ETag']);
        done();
      });
    });
  });
});
