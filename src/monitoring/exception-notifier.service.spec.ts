import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExceptionNotifierService,
  AlertSeverity,
  NotificationChannel,
} from './exception-notifier.service';
import { SentryService } from '../common/sentry';
import { PrometheusService } from './metrics/prometheus.service';

const mockRegistry = {
  metrics: jest.fn(),
};

const mockCounter = { inc: jest.fn() };
const mockGauge = { inc: jest.fn(), set: jest.fn() };

jest.mock('prom-client', () => ({
  Counter: jest.fn(() => mockCounter),
  Gauge: jest.fn(() => mockGauge),
}));

describe('ExceptionNotifierService', () => {
  let service: ExceptionNotifierService;
  let sentry: jest.Mocked<SentryService>;
  let configService: jest.Mocked<ConfigService>;

  const buildService = async (env = 'development') => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExceptionNotifierService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockImplementation((key: string, def: unknown) => {
            if (key === 'app.env') return env;
            return def;
          })},
        },
        {
          provide: SentryService,
          useValue: { captureException: jest.fn() },
        },
        {
          provide: PrometheusService,
          useValue: { registry: mockRegistry },
        },
      ],
    }).compile();

    const svc = module.get(ExceptionNotifierService);
    svc.onModuleInit();
    return {
      service: svc,
      sentry: module.get(SentryService) as jest.Mocked<SentryService>,
      config: module.get(ConfigService) as jest.Mocked<ConfigService>,
    };
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ service, sentry, configService } = await buildService());
  });

  describe('notifyException', () => {
    it('dispatches to registered channels', async () => {
      const notify = jest.fn().mockResolvedValue(undefined);
      const channel: NotificationChannel = { name: 'test', enabled: true, notify };
      service.registerChannel(channel);

      await service.notifyException(new Error('boom'), { path: '/test' });

      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('skips disabled channels', async () => {
      const notify = jest.fn();
      service.registerChannel({ name: 'off', enabled: false, notify });

      await service.notifyException(new Error('boom'));

      expect(notify).not.toHaveBeenCalled();
    });

    it('does not throw when a channel fails', async () => {
      const notify = jest.fn().mockRejectedValue(new Error('channel down'));
      service.registerChannel({ name: 'flaky', enabled: true, notify });

      await expect(
        service.notifyException(new Error('boom'), { path: '/api' }),
      ).resolves.not.toThrow();
    });

    it('suppresses low-severity 4xx exceptions in production', async () => {
      const { service: prodService } = await buildService('production');
      const notify = jest.fn();
      prodService.registerChannel({ name: 'ch', enabled: true, notify });

      await prodService.notifyException(
        new HttpException('Not found', HttpStatus.NOT_FOUND),
        { path: '/missing' },
      );

      expect(notify).not.toHaveBeenCalled();
    });

    it('calls sentry for critical exceptions in production', async () => {
      const { service: prodService, sentry: prodSentry } = await buildService('production');

      await prodService.notifyException(new Error('critical!'), { path: '/crash' });

      expect(prodSentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ severity: AlertSeverity.CRITICAL }),
      );
    });

    it('throttles repeated identical exceptions', async () => {
      const notify = jest.fn().mockResolvedValue(undefined);
      service.registerChannel({ name: 'ch', enabled: true, notify });

      const err = new Error('repeat');
      for (let i = 0; i < 10; i++) {
        await service.notifyException(err, { path: '/flap' });
      }

      // Only first 3 should pass throttle (throttleMaxPerWindow = 3)
      expect(notify).toHaveBeenCalledTimes(3);
    });

    it('resets throttle and allows new notifications', async () => {
      const notify = jest.fn().mockResolvedValue(undefined);
      service.registerChannel({ name: 'ch', enabled: true, notify });

      const err = new Error('repeat');
      for (let i = 0; i < 5; i++) {
        await service.notifyException(err, { path: '/path' });
      }
      service.resetThrottle();
      await service.notifyException(err, { path: '/path' });

      expect(notify.mock.calls.length).toBeGreaterThan(3);
    });
  });

  describe('severity classification', () => {
    it('classifies 500 HttpException as HIGH', async () => {
      const { service: prodService, sentry: prodSentry } = await buildService('production');
      const notify = jest.fn().mockResolvedValue(undefined);
      prodService.registerChannel({ name: 'ch', enabled: true, notify });

      await prodService.notifyException(
        new HttpException('Server Error', HttpStatus.INTERNAL_SERVER_ERROR),
        { path: '/api' },
      );

      expect(prodSentry.captureException).toHaveBeenCalled();
    });

    it('classifies TypeError as HIGH in non-production', async () => {
      const notify = jest.fn().mockResolvedValue(undefined);
      service.registerChannel({ name: 'ch', enabled: true, notify });

      await service.notifyException(new TypeError('undefined is not a function'));

      expect(notify).toHaveBeenCalledWith(
        expect.any(TypeError),
        expect.objectContaining({ severity: AlertSeverity.HIGH }),
      );
    });
  });
});
