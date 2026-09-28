import { LoggerService } from '../src/common/logger/logger.service';
import { CorrelationIdStore } from '../src/common/correlation/correlation-id.store';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';

function makeConfigService(): ConfigService {
  const map: Record<string, any> = {
    'app.nodeEnv': 'production',
    'app.logger.level': 'info',
    'app.logger.directory': '/tmp/logs',
    'app.logger.maxFiles': '14d',
    'app.logger.maxSize': '20m',
  };
  return { get: (key: string, def?: any) => map[key] ?? def } as unknown as ConfigService;
}

function makeStore(correlationId?: string): CorrelationIdStore {
  const store = new CorrelationIdStore();
  jest.spyOn(store, 'getCorrelationId').mockReturnValue(correlationId);
  return store;
}

describe('LoggerService structured JSON logging', () => {
  it('instantiates without errors in production mode', () => {
    const logger = new LoggerService(makeConfigService(), makeStore());
    expect(logger).toBeDefined();
  });

  it('redacts sensitive fields', () => {
    const logger = new LoggerService(makeConfigService(), makeStore());
    const spy = jest.spyOn((logger as any).logger, 'info');

    logger.info('test message', { password: 'secret123', userId: 'abc' });

    expect(spy).toHaveBeenCalledWith(
      'test message',
      expect.objectContaining({ password: '[REDACTED]', userId: 'abc' }),
    );
  });

  it('logs errors with stack trace', () => {
    const logger = new LoggerService(makeConfigService(), makeStore());
    const spy = jest.spyOn((logger as any).logger as winston.Logger, 'error');
    const err = new Error('boom');

    logger.error('something failed', err);

    expect(spy).toHaveBeenCalledWith(
      'something failed',
      expect.objectContaining({
        error: expect.objectContaining({ message: 'boom', stack: expect.any(String) }),
      }),
    );
  });

  it('handles circular references without throwing', () => {
    const logger = new LoggerService(makeConfigService(), makeStore());
    const circular: any = { a: 1 };
    circular.self = circular;

    expect(() => logger.info('circular test', circular)).not.toThrow();
  });

  // ── smoke test: correlation ID propagation ──────────────────────────────

  it('stamps every log line with the correlationId from CorrelationIdStore', () => {
    const store = makeStore('smoke-corr-id-001');
    const logger = new LoggerService(makeConfigService(), store);
    const spy = jest.spyOn((logger as any).logger as winston.Logger, 'info');

    logger.info('smoke test message', { tradeId: 'tr-99' });

    expect(spy).toHaveBeenCalledWith(
      'smoke test message',
      expect.objectContaining({ correlationId: 'smoke-corr-id-001', tradeId: 'tr-99' }),
    );
  });

  it('omits correlationId field when no request context is active', () => {
    const store = makeStore(undefined);
    const logger = new LoggerService(makeConfigService(), store);
    const spy = jest.spyOn((logger as any).logger as winston.Logger, 'info');

    logger.info('no-context message');

    const call = spy.mock.calls[0][1] as Record<string, any>;
    expect(call).not.toHaveProperty('correlationId');
  });

  it('propagates correlationId through CorrelationIdStore.run() context', () => {
    const realStore = new CorrelationIdStore();
    const logger = new LoggerService(makeConfigService(), realStore);
    const spy = jest.spyOn((logger as any).logger as winston.Logger, 'info');

    realStore.run({ correlationId: 'e2e-corr-abc' }, () => {
      logger.info('inside request context');
    });

    expect(spy).toHaveBeenCalledWith(
      'inside request context',
      expect.objectContaining({ correlationId: 'e2e-corr-abc' }),
    );
  });
});
