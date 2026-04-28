import { LoggerService } from '../src/common/logger/logger.service';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';

describe('LoggerService structured JSON logging (#371)', () => {
  let logger: LoggerService;
  let winstonSpy: jest.SpyInstance;

  beforeEach(() => {
    const configService = {
      get: (key: string, defaultVal?: any) => {
        const map: Record<string, any> = {
          'app.nodeEnv': 'production',
          'app.logger.level': 'info',
          'app.logger.directory': '/tmp/logs',
          'app.logger.maxFiles': '14d',
          'app.logger.maxSize': '20m',
        };
        return map[key] ?? defaultVal;
      },
    } as unknown as ConfigService;

    logger = new LoggerService(configService);
  });

  it('should instantiate without errors in production mode', () => {
    expect(logger).toBeDefined();
  });

  it('should redact sensitive fields', () => {
    const internalLogger = (logger as any).logger as winston.Logger;
    const writeSpy = jest.spyOn(internalLogger, 'info');

    logger.info('test message', { password: 'secret123', userId: 'abc' });

    expect(writeSpy).toHaveBeenCalledWith(
      'test message',
      expect.objectContaining({ password: '[REDACTED]', userId: 'abc' }),
    );
  });

  it('should log errors with stack trace', () => {
    const internalLogger = (logger as any).logger as winston.Logger;
    const errorSpy = jest.spyOn(internalLogger, 'error');
    const err = new Error('boom');

    logger.error('something failed', err);

    expect(errorSpy).toHaveBeenCalledWith(
      'something failed',
      expect.objectContaining({
        error: expect.objectContaining({ message: 'boom', stack: expect.any(String) }),
      }),
    );
  });

  it('should handle circular references without throwing', () => {
    const circular: any = { a: 1 };
    circular.self = circular;

    expect(() => logger.info('circular test', circular)).not.toThrow();
  });
});
