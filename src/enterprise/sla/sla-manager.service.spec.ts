import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { SlaManagerService } from './sla-manager.service';
import { SlaAgreement, SlaAgreementStatus } from './entities/sla-agreement.entity';
import { SlaViolation, ViolationSeverity } from './entities/sla-violation.entity';
import { MetricType } from './entities/sla-metric.entity';
import { SlaTierName } from './interfaces/sla-tier.interface';
import { UptimeMonitor } from './monitors/uptime-monitor';
import { ResponseTimeMonitor } from './monitors/response-time-monitor';
import { ThroughputMonitor } from './monitors/throughput-monitor';

const mockRepo = () => ({
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'generated-id', ...v })),
  findOne: jest.fn(),
  findOneOrFail: jest.fn(),
  find: jest.fn(),
});

const mockAgreement = (): Partial<SlaAgreement> => ({
  id: 'agreement-1',
  userId: 'user-1',
  clientName: 'Acme Corp',
  tier: SlaTierName.GOLD,
  uptimePercent: '99.9',
  maxResponseTimeMs: 500,
  maxErrorRatePercent: '0.5',
  minThroughputRpm: 2000,
  supportResponseHours: 4,
  priorityRouting: true,
  status: SlaAgreementStatus.ACTIVE,
  startsAt: new Date(),
});

describe('SlaManagerService', () => {
  let service: SlaManagerService;
  let agreementRepo: ReturnType<typeof mockRepo>;
  let violationRepo: ReturnType<typeof mockRepo>;
  let uptimeMonitor: jest.Mocked<UptimeMonitor>;
  let responseTimeMonitor: jest.Mocked<ResponseTimeMonitor>;
  let throughputMonitor: jest.Mocked<ThroughputMonitor>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlaManagerService,
        { provide: getRepositoryToken(SlaAgreement), useFactory: mockRepo },
        { provide: getRepositoryToken(SlaViolation), useFactory: mockRepo },
        {
          provide: UptimeMonitor,
          useValue: { measure: jest.fn(), record: jest.fn() },
        },
        {
          provide: ResponseTimeMonitor,
          useValue: { measure: jest.fn(), record: jest.fn() },
        },
        {
          provide: ThroughputMonitor,
          useValue: { measure: jest.fn(), record: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(SlaManagerService);
    agreementRepo = module.get(getRepositoryToken(SlaAgreement));
    violationRepo = module.get(getRepositoryToken(SlaViolation));
    uptimeMonitor = module.get(UptimeMonitor);
    responseTimeMonitor = module.get(ResponseTimeMonitor);
    throughputMonitor = module.get(ThroughputMonitor);
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('createAgreement', () => {
    it('creates agreement with tier defaults', async () => {
      const result = await service.createAgreement({
        userId: 'user-1',
        clientName: 'Acme Corp',
        tier: SlaTierName.GOLD,
        startsAt: new Date().toISOString(),
      });

      expect(agreementRepo.save).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ tier: SlaTierName.GOLD });
    });
  });

  describe('getAgreement', () => {
    it('returns agreement when found', async () => {
      agreementRepo.findOne.mockResolvedValue(mockAgreement());
      const result = await service.getAgreement('agreement-1');
      expect(result.id).toBe('agreement-1');
    });

    it('throws NotFoundException when not found', async () => {
      agreementRepo.findOne.mockResolvedValue(null);
      await expect(service.getAgreement('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('generateReport', () => {
    it('marks slaCompliant=true when all metrics pass', async () => {
      agreementRepo.findOne.mockResolvedValue(mockAgreement());
      uptimeMonitor.measure.mockResolvedValue({ uptimePercent: 99.95, breached: false, windowStart: new Date(), windowEnd: new Date(), totalMinutes: 1440, downtimeMinutes: 0 });
      responseTimeMonitor.measure.mockResolvedValue({ avg: 120, p95: 300, p99: 450, sampleCount: 1000 });
      throughputMonitor.measure.mockResolvedValue({ avgRpm: 3000, peakRpm: 5000, totalRequests: 100000, errorRatePercent: 0.2 });
      violationRepo.find.mockResolvedValue([]);

      const report = await service.generateReport('agreement-1', new Date(), new Date());

      expect(report.slaCompliant).toBe(true);
      expect(report.breachCount).toBe(0);
    });

    it('marks slaCompliant=false when p95 exceeds threshold', async () => {
      agreementRepo.findOne.mockResolvedValue(mockAgreement());
      uptimeMonitor.measure.mockResolvedValue({ uptimePercent: 99.95, breached: false, windowStart: new Date(), windowEnd: new Date(), totalMinutes: 1440, downtimeMinutes: 0 });
      responseTimeMonitor.measure.mockResolvedValue({ avg: 800, p95: 1200, p99: 2000, sampleCount: 500 }); // p95 > 500ms
      throughputMonitor.measure.mockResolvedValue({ avgRpm: 3000, peakRpm: 5000, totalRequests: 50000, errorRatePercent: 0.3 });
      violationRepo.find.mockResolvedValue([{ severity: ViolationSeverity.BREACH }]);

      const report = await service.generateReport('agreement-1', new Date(), new Date());

      expect(report.slaCompliant).toBe(false);
      expect(report.breachCount).toBe(1);
    });
  });

  describe('checkAndRecordViolations', () => {
    it('records violation when uptime is breached', async () => {
      agreementRepo.findOne.mockResolvedValue(mockAgreement());
      uptimeMonitor.measure.mockResolvedValue({ uptimePercent: 98.5, breached: true, windowStart: new Date(), windowEnd: new Date(), totalMinutes: 60, downtimeMinutes: 52 });
      responseTimeMonitor.measure.mockResolvedValue({ avg: 100, p95: 200, p99: 300, sampleCount: 100 });
      throughputMonitor.measure.mockResolvedValue({ avgRpm: 3000, peakRpm: 4000, totalRequests: 3000, errorRatePercent: 0.1 });
      violationRepo.save.mockResolvedValue({});

      const alerts = await service.checkAndRecordViolations('agreement-1');

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].metricType).toBe(MetricType.UPTIME);
    });

    it('returns empty array when all metrics are within SLA', async () => {
      agreementRepo.findOne.mockResolvedValue(mockAgreement());
      uptimeMonitor.measure.mockResolvedValue({ uptimePercent: 99.99, breached: false, windowStart: new Date(), windowEnd: new Date(), totalMinutes: 60, downtimeMinutes: 0 });
      responseTimeMonitor.measure.mockResolvedValue({ avg: 80, p95: 150, p99: 200, sampleCount: 500 });
      throughputMonitor.measure.mockResolvedValue({ avgRpm: 5000, peakRpm: 8000, totalRequests: 5000, errorRatePercent: 0.05 });

      const alerts = await service.checkAndRecordViolations('agreement-1');

      expect(alerts).toHaveLength(0);
    });
  });

  describe('terminateAgreement', () => {
    it('sets status to TERMINATED', async () => {
      const agreement = mockAgreement() as SlaAgreement;
      agreementRepo.findOne.mockResolvedValue(agreement);
      agreementRepo.save.mockResolvedValue({ ...agreement, status: SlaAgreementStatus.TERMINATED });

      const result = await service.terminateAgreement('agreement-1');

      expect(agreementRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: SlaAgreementStatus.TERMINATED }),
      );
      expect(result.status).toBe(SlaAgreementStatus.TERMINATED);
    });
  });
});
