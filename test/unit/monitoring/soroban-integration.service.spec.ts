import { Test, TestingModule } from '@nestjs/testing';
import { SorobanIntegrationService } from '../../../src/monitoring/alerts/soroban-integration.service';
import { SorobanService } from '../../../src/soroban/soroban.service';
import { SorobanMonitoringService } from '../../../src/monitoring/alerts/soroban-monitoring.service';

describe('SorobanIntegrationService', () => {
  let service: SorobanIntegrationService;
  let sorobanService: jest.Mocked<SorobanService>;
  let monitoringService: jest.Mocked<SorobanMonitoringService>;

  beforeEach(async () => {
    const mockSorobanService = {
      invokeContract: jest.fn(),
    };

    const mockMonitoringService = {
      recordFailure: jest.fn(),
      getMetrics: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanIntegrationService,
        {
          provide: SorobanService,
          useValue: mockSorobanService,
        },
        {
          provide: SorobanMonitoringService,
          useValue: mockMonitoringService,
        },
      ],
    }).compile();

    service = module.get<SorobanIntegrationService>(SorobanIntegrationService);
    sorobanService = module.get(SorobanService);
    monitoringService = module.get(SorobanMonitoringService);
  });

  describe('onModuleInit', () => {
    it('should inject monitoring service into soroban service', () => {
      service.onModuleInit();

      expect((sorobanService as any).sorobanMonitoring).toBe(monitoringService);
    });
  });
});