import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { DeadlockRetryInterceptor } from './deadlock-retry.interceptor';

function makeContext(): ExecutionContext {
  return {} as ExecutionContext;
}

function makeHandler(obs: any): CallHandler {
  return { handle: () => obs };
}

describe('DeadlockRetryInterceptor', () => {
  let interceptor: DeadlockRetryInterceptor;

  beforeEach(() => {
    interceptor = new DeadlockRetryInterceptor();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('passes through successful responses unchanged', (done) => {
    const handler = makeHandler(of({ id: 1 }));
    interceptor.intercept(makeContext(), handler).subscribe({
      next: (val) => {
        expect(val).toEqual({ id: 1 });
        done();
      },
    });
  });

  it('retries on deadlock_detected (40P01) and succeeds on second attempt', (done) => {
    const deadlock = Object.assign(new Error('deadlock'), { code: '40P01' });
    let calls = 0;
    const handler: CallHandler = {
      handle: () => {
        calls++;
        return calls === 1 ? throwError(() => deadlock) : of('ok');
      },
    };

    interceptor.intercept(makeContext(), handler).subscribe({
      next: (val) => {
        expect(val).toBe('ok');
        expect(calls).toBe(2);
        done();
      },
      error: done.fail,
    });

    jest.runAllTimers();
  });

  it('retries on serialization_failure (40001)', (done) => {
    const serial = Object.assign(new Error('serial'), { code: '40001' });
    let calls = 0;
    const handler: CallHandler = {
      handle: () => {
        calls++;
        return calls < 3 ? throwError(() => serial) : of('done');
      },
    };

    interceptor.intercept(makeContext(), handler).subscribe({
      next: (val) => {
        expect(val).toBe('done');
        done();
      },
      error: done.fail,
    });

    jest.runAllTimers();
  });

  it('does NOT retry on non-retryable errors', (done) => {
    const notFound = Object.assign(new Error('not found'), { code: '23503' });
    let calls = 0;
    const handler: CallHandler = {
      handle: () => {
        calls++;
        return throwError(() => notFound);
      },
    };

    interceptor.intercept(makeContext(), handler).subscribe({
      error: (err) => {
        expect(err.code).toBe('23503');
        expect(calls).toBe(1);
        done();
      },
    });
  });

  it('propagates error after exhausting MAX_RETRIES (3)', (done) => {
    const deadlock = Object.assign(new Error('deadlock'), { code: '40P01' });
    let calls = 0;
    const handler: CallHandler = {
      handle: () => {
        calls++;
        return throwError(() => deadlock);
      },
    };

    interceptor.intercept(makeContext(), handler).subscribe({
      error: (err) => {
        expect(err.code).toBe('40P01');
        // 1 initial + 3 retries = 4 total calls
        expect(calls).toBe(4);
        done();
      },
    });

    jest.runAllTimers();
  });

  it('handles driverError.code for wrapped TypeORM errors', (done) => {
    const wrapped = Object.assign(new Error('wrapped'), {
      driverError: { code: '40P01' },
    });
    let calls = 0;
    const handler: CallHandler = {
      handle: () => {
        calls++;
        return calls === 1 ? throwError(() => wrapped) : of('recovered');
      },
    };

    interceptor.intercept(makeContext(), handler).subscribe({
      next: (val) => {
        expect(val).toBe('recovered');
        done();
      },
      error: done.fail,
    });

    jest.runAllTimers();
  });
});
