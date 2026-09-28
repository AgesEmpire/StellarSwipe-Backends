import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { SorobanMonitoringService } from '../../../src/monitoring/alerts/soroban-monitoring.service';

describe('SorobanMonitoringService', () => {
  let service: SorobanMonitoringService;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config = {
          SOROBAN_ALERT_THRESHOLD: 5,
          SOROBAN_ALERT_WINDOW_MS: 300000,
        };
        return config[key] || defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanMonitoringService,
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<SorobanMonitoringService>(SorobanMonitoringService);
    eventEmitter = module.get(EventEmitter2);
    configService = module.get(ConfigService);
  });

  describe('recordFailure', () => {
    it('should record failure and not trigger alert below threshold', () => {
      const failure = {
        contractId: 'test-contract',
        method: 'test-method',
        error: 'Test error',
        timestamp: new Date(),
        endpoint: '/api/test',
        userId: 'user123',
      };

      service.recordFailure(failure);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should trigger alert when threshold is exceeded', () => {
      const failure = {
        contractId: 'test-contract',
        method: 'test-method',
        error: 'Test error',
        timestamp: new Date(),
        endpoint: '/api/test',
        userId: 'user123',
      };

      // Record failures to exceed threshold
      for (let i = 0; i < 6; i++) {
        service.recordFailure({ ...failure, timestamp: new Date() });
      }

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'alert.soroban.failure',
        expect.objectContaining({
          type: 'soroban_failure_spike',
          severity: expect.any(String),
        })
      );
    });
  });

  describe('getMetrics', () => {
    it('should return current metrics', () => {
      const metrics = service.getMetrics();

      expect(metrics).toHaveProperty('failureCount');
      expect(metrics).toHaveProperty('failureRate');
      expect(metrics).toHaveProperty('affectedEndpoints');
      expect(metrics).toHaveProperty('affectedUsers');
      expect(metrics).toHaveProperty('recentErrors');
    });
  });

  describe('clearHistory', () => {
    it('should clear failure history', () => {
      const failure = {
        contractId: 'test-contract',
        method: 'test-method',
        error: 'Test error',
        timestamp: new Date(),
      };

      service.recordFailure(failure);
      service.clearHistory();

      const history = service.getFailureHistory();
      expect(history).toHaveLength(0);
    });
  });
});