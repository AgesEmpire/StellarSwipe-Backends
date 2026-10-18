import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MultipartCleanupInterceptor } from './multipart-cleanup.interceptor';

function makeContext(request: Record<string, unknown>, response: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function makeRequest(overrides: Partial<Record<string, unknown>> = {}) {
  const listeners: Record<string, () => void> = {};
  return {
    once: (event: string, cb: () => void) => {
      listeners[event] = cb;
    },
    emit: (event: string) => listeners[event]?.(),
    ...overrides,
  };
}

function makeResponse(writableFinished = true) {
  const listeners: Record<string, () => void> = {};
  return {
    writableFinished,
    once: (event: string, cb: () => void) => {
      listeners[event] = cb;
    },
    emit: (event: string) => listeners[event]?.(),
  };
}

describe('MultipartCleanupInterceptor', () => {
  let interceptor: MultipartCleanupInterceptor;
  let tempFile: string;

  beforeEach(() => {
    interceptor = new MultipartCleanupInterceptor();
    tempFile = path.join(os.tmpdir(), `stellarswipe-multipart-cleanup-test-${Date.now()}.part`);
    fs.writeFileSync(tempFile, 'partial-data');
  });

  afterEach(() => {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  });

  it('removes the temp file once the handler completes successfully', async () => {
    const request = makeRequest({ file: { path: tempFile } });
    const response = makeResponse(true);
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    await new Promise<void>((resolve) => {
      interceptor.intercept(makeContext(request, response), handler).subscribe({
        complete: resolve,
      });
    });

    expect(fs.existsSync(tempFile)).toBe(false);
  });

  it('removes the temp file when the handler throws a validation error', async () => {
    const request = makeRequest({ file: { path: tempFile } });
    const response = makeResponse(true);
    const handler: CallHandler = { handle: () => throwError(() => new Error('invalid payload')) };

    await new Promise<void>((resolve) => {
      interceptor.intercept(makeContext(request, response), handler).subscribe({
        error: () => resolve(),
      });
    });

    expect(fs.existsSync(tempFile)).toBe(false);
  });

  it('removes temp files for every item in a batch upload', async () => {
    const secondFile = `${tempFile}.second`;
    fs.writeFileSync(secondFile, 'partial-data-2');
    const request = makeRequest({ files: [{ path: tempFile }, { path: secondFile }] });
    const response = makeResponse(true);
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    await new Promise<void>((resolve) => {
      interceptor.intercept(makeContext(request, response), handler).subscribe({
        complete: resolve,
      });
    });

    expect(fs.existsSync(tempFile)).toBe(false);
    expect(fs.existsSync(secondFile)).toBe(false);
  });

  it('removes the temp file when the client disconnects before the response finishes', () => {
    const request = makeRequest({ file: { path: tempFile } });
    const response = makeResponse(false);
    // The handler's observable never settles because the request aborted
    // mid-upload — cleanup must come from the socket-level listener instead.
    const handler: CallHandler = { handle: () => of(undefined) };

    interceptor.intercept(makeContext(request, response), handler);
    (response as unknown as { emit: (e: string) => void }).emit('close');

    expect(fs.existsSync(tempFile)).toBe(false);
  });

  it('is a no-op when the request has no multipart file', async () => {
    const request = makeRequest({});
    const response = makeResponse(true);
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    const result = await new Promise((resolve) => {
      interceptor.intercept(makeContext(request, response), handler).subscribe({
        next: resolve,
      });
    });

    expect(result).toEqual({ ok: true });
  });
});
