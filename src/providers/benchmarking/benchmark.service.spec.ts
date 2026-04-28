import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { BenchmarkService } from './benchmark.service';
import { ProviderBenchmark } from './entities/benchmark.entity';
import { PeerGroup } from './entities/peer-group.entity';
import {
  BenchmarkType,
  MetricCategory,
  PerformanceTier,
} from './interfaces/benchmark-metric.interface';

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const buildMetrics = (overrides: Record<string, number> = {}) => [
  {
    name: 'total_return',
    category: MetricCategory.RETURN,
    providerValue: 0.12,
    benchmarkValue: 0.09,
    delta: 0.03,
    deltaPercent: 33.33,
    percentileRank: 72,
    performanceTier: PerformanceTier.ABOVE_AVERAGE,
    weight: 0.25,
  },
  {
    name: 'sharpe_ratio',
    category: MetricCategory.EFFICIENCY,
    providerValue: 1.4,
    benchmarkValue: 1.1,
    delta: 0.3,
    deltaPercent: 27.27,
    percentileRank: 68,
    performanceTier: PerformanceTier.ABOVE_AVERAGE,
    weight: 0.2,
  },
  {
    name: 'max_drawdown',
    category: MetricCategory.RISK,
    providerValue: -0.08,
    benchmarkValue: -0.12,
    delta: 0.04,
    deltaPercent: 33.33,
    percentileRank: 78,
    performanceTier: PerformanceTier.TOP,
    weight: 0.15,
  },
  {
    name: 'win_rate',
    category: MetricCategory.CONSISTENCY,
    providerValue: 0.61,
    benchmarkValue: 0.55,
    delta: 0.06,
    deltaPercent: 10.9,
    percentileRank: 65,
    performanceTier: PerformanceTier.ABOVE_AVERAGE,
    weight: 0.15,
  },
];

const buildEntity = (
  overrides: Partial<ProviderBenchmark> = {},
): ProviderBenchmark =>
  ({
    id: 'bm-uuid-1',
    providerId: 'prov-001',
    benchmarkType: BenchmarkType.PLATFORM,
    referenceId: null,
    periodStart: new Date('2024-01-01'),
    periodEnd: new Date('2024-01-31'),
    overallScore: 70.5,
    overallPercentile: 68.0,
    overallTier: PerformanceTier.ABOVE_AVERAGE,
    metrics: buildMetrics(),
    platformStats: null,
    sampleSize: 50,
    calculatedAt: new Date('2024-02-01'),
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-01'),
    ...overrides,
  }) as ProviderBenchmark;

describe('BenchmarkService', () => {
  let service: BenchmarkService;
  let benchmarkRepo: ReturnType<typeof mockRepo>;
  let peerGroupRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BenchmarkService,
        {
          provide: getRepositoryToken(ProviderBenchmark),
          useFactory: mockRepo,
        },
        { provide: getRepositoryToken(PeerGroup), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get<BenchmarkService>(BenchmarkService);
    benchmarkRepo = module.get(getRepositoryToken(ProviderBenchmark));
    peerGroupRepo = module.get(getRepositoryToken(PeerGroup));
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------
  // getBenchmarkReport
  // -------------------------
  describe('getBenchmarkReport', () => {
    it('should return a benchmark report for a known provider', async () => {
      benchmarkRepo.findOne.mockResolvedValue(buildEntity());

      const result = await service.getBenchmarkReport({
        providerId: 'prov-001',
      });

      expect(result.providerId).toBe('prov-001');
      expect(result.overallPercentile).toBe(68);
      expect(result.metrics).toHaveLength(4);
      expect(result.insights.length).toBeGreaterThan(0);
    });

    it('should throw NotFoundException when provider has no benchmarks', async () => {
      benchmarkRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getBenchmarkReport({ providerId: 'unknown' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------
  // getBenchmarkHistory
  // -------------------------
  describe('getBenchmarkHistory', () => {
    it('should return ordered benchmark history entries', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([buildEntity(), buildEntity()]),
      };
      benchmarkRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getBenchmarkHistory({
        providerId: 'prov-001',
      });

      expect(result.providerId).toBe('prov-001');
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]).toHaveProperty('overallScore');
    });
  });

  // -------------------------
  // calculateAndStoreBenchmarks
  // -------------------------
  describe('calculateAndStoreBenchmarks', () => {
    it('should process all providers and return counts', async () => {
      benchmarkRepo.create.mockImplementation((data) => data);
      benchmarkRepo.save.mockResolvedValue({});

      const providers = [
        {
          providerId: 'prov-001',
          metrics: {
            total_return: 0.12,
            sharpe_ratio: 1.4,
            max_drawdown: -0.08,
            win_rate: 0.61,
            volatility: 0.15,
            sortino_ratio: 1.6,
            calmar_ratio: 0.9,
          },
        },
        {
          providerId: 'prov-002',
          metrics: {
            total_return: 0.08,
            sharpe_ratio: 0.9,
            max_drawdown: -0.15,
            win_rate: 0.5,
            volatility: 0.2,
            sortino_ratio: 1.1,
            calmar_ratio: 0.6,
          },
        },
      ];

      const result = await service.calculateAndStoreBenchmarks(providers);

      expect(result.processed).toBe(2);
      expect(result.errors).toBe(0);
    });

    it('should count errors when save fails for a provider', async () => {
      benchmarkRepo.create.mockImplementation((data) => data);
      benchmarkRepo.save
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('DB error'));

      const providers = [
        {
          providerId: 'prov-001',
          metrics: { total_return: 0.12, sharpe_ratio: 1.4 },
        },
        {
          providerId: 'prov-002',
          metrics: { total_return: 0.08, sharpe_ratio: 0.9 },
        },
      ];

      const result = await service.calculateAndStoreBenchmarks(providers);

      expect(result.processed).toBe(1);
      expect(result.errors).toBe(1);
    });
  });

  // -------------------------
  // getPercentileRanks
  // -------------------------
  describe('getPercentileRanks', () => {
    it('should return percentile rankings and identify strongest/weakest metrics', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        distinctOn: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([buildEntity(), buildEntity()]),
      };
      benchmarkRepo.findOne.mockResolvedValue(buildEntity());
      benchmarkRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getPercentileRanks({
        providerId: 'prov-001',
      });

      expect(result.providerId).toBe('prov-001');
      expect(result.metricRankings.length).toBeGreaterThan(0);
      expect(result.strongestMetrics.length).toBeGreaterThan(0);
      expect(result.weakestMetrics.length).toBeGreaterThan(0);
    });

    it('should throw NotFoundException for unknown provider', async () => {
      benchmarkRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getPercentileRanks({ providerId: 'unknown' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
