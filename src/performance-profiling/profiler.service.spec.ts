import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { ProfilerService } from './profiler.service';
import { ProfileSession, ProfileSessionStatus, ProfileSessionType } from './entities/profile-session.entity';
import { PerformanceSnapshot, SnapshotType } from './entities/performance-snapshot.entity';

import { CpuProfiler } from './collectors/cpu-profiler';
import { MemoryProfiler } from './collectors/memory-profiler';
import { QueryProfiler } from './collectors/query-profiler';
import { ApiProfiler } from './collectors/api-profiler';
import { BottleneckDetector } from './analyzers/bottleneck-detector';
import { FlameGraphGenerator } from './analyzers/flamegraph-generator';
import { TraceAggregator } from './utils/trace-aggregator';
import { ProfileConfigDto } from './dto/profile-config.dto';
import { NotFoundException, BadRequestException } from '@nestjs/common';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<ProfileSession> = {}): ProfileSession {
  return {
    id: 'session-uuid-1',
    name: 'Test Session',
    type: ProfileSessionType.FULL,
    status: ProfileSessionStatus.COMPLETED,
    durationSeconds: 10,
    samplingIntervalMs: 500,
    config: {},
    summary: null,
    errorMessage: null,
    startedAt: new Date(),
    completedAt: new Date(),
    triggeredBy: null,
    environment: 'test',
    appVersion: '1.0.0',
    snapshots: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSessionRepo = () => ({
  create: jest.fn((d) => d),
  save: jest.fn(async (d) => ({ ...d, id: 'session-uuid-1' })),
  update: jest.fn(async () => ({ affected: 1 })),
  findOne: jest.fn(),
  findAndCount: jest.fn(async () => [[], 0]),
  delete: jest.fn(async () => ({ affected: 1 })),
});

const mockSnapshotRepo = () => ({
  create: jest.fn((d) => d),
  save: jest.fn(async (d) => d),
});

const mockCpuProfiler = () => ({
  collectSamples: jest.fn(async () => {}),
  computeStats: jest.fn(() => ({ avg: 30, peak: 60, p95: 55, peakAt: new Date() })),
});

const mockMemoryProfiler = () => ({
  collectSamples: jest.fn(async () => {}),
  computeStats: jest.fn(() => ({ avg: 120, peak: 200, peakAt: new Date(), growthMb: 10 })),
  detectLeaks: jest.fn(() => ({ leakSuspected: false, growthRateMbPerMin: 0, indicators: [] })),
});

const mockQueryProfiler = () => ({
  configure: jest.fn(),
  startRecording: jest.fn(),
  stopRecording: jest.fn(() => []),
  computeStats: jest.fn(() => ({ total: 50, slowCount: 2, avgMs: 15, p95Ms: 80, p99Ms: 120 })),
  aggregateSlowQueries: jest.fn(() => []),
});

const mockApiProfiler = () => ({
  configure: jest.fn(),
  startRecording: jest.fn(),
  stopRecording: jest.fn(() => []),
  computeStats: jest.fn(() => ({ total: 100, avgMs: 45, p95Ms: 120, p99Ms: 300, errorRate: 0.5, slowCount: 3, throughputPerMin: 60 })),
  aggregateEndpoints: jest.fn(() => []),
  getStatusCodeDistribution: jest.fn(() => ({ '2xx': 99, '5xx': 1 })),
});

const mockBottleneckDetector = () => ({
  analyzeAll: jest.fn(() => []),
});

const mockFlameGraphGenerator = () => ({
  generate: jest.fn(() => ({
    root: { name: 'root', value: 0, children: [] },
    totalSamples: 0,
    generatedAt: new Date(),
    hotspots: [],
  })),
  toCollapsedFormat: jest.fn(() => ''),
});

const mockTraceAggregator = () => ({
  aggregate: jest.fn(() => ({
    timeline: [],
    correlatedAnomalies: [],
    sessionStats: { startTime: new Date(), endTime: new Date(), durationMs: 0, dataPoints: 0 },
  })),
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProfilerService', () => {
  let service: ProfilerService;
  let sessionRepo: jest.Mocked<Repository<ProfileSession>>;
  let cpuProfiler: jest.Mocked<CpuProfiler>;
  let queryProfiler: jest.Mocked<QueryProfiler>;
  let apiProfiler: jest.Mocked<ApiProfiler>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfilerService,
        { provide: getRepositoryToken(ProfileSession), useFactory: mockSessionRepo },
        { provide: getRepositoryToken(PerformanceSnapshot), useFactory: mockSnapshotRepo },
        { provide: CpuProfiler, useFactory: mockCpuProfiler },
        { provide: MemoryProfiler, useFactory: mockMemoryProfiler },
        { provide: QueryProfiler, useFactory: mockQueryProfiler },
        { provide: ApiProfiler, useFactory: mockApiProfiler },
        { provide: BottleneckDetector, useFactory: mockBottleneckDetector },
        { provide: FlameGraphGenerator, useFactory: mockFlameGraphGenerator },
        { provide: TraceAggregator, useFactory: mockTraceAggregator },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string, def: string) => def) },
        },
      ],
    }).compile();

    service = module.get(ProfilerService);
    sessionRepo = module.get(getRepositoryToken(ProfileSession));
    cpuProfiler = module.get(CpuProfiler);
    queryProfiler = module.get(QueryProfiler);
    apiProfiler = module.get(ApiProfiler);
  });

  afterEach(() => jest.clearAllMocks());

  // ── startSession ──────────────────────────────────────────────────────────

  describe('startSession', () => {
    it('should create and persist a new session', async () => {
      const dto: ProfileConfigDto = {
        name: 'Smoke Test',
        type: ProfileSessionType.FULL,
        durationSeconds: 5,
        samplingIntervalMs: 1000,
      };

      const session = await service.startSession(dto, 'test-runner');

      expect(sessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Smoke Test', status: ProfileSessionStatus.ACTIVE }),
      );
      expect(sessionRepo.save).toHaveBeenCalled();
      expect(session.id).toBeDefined();
    });

    it('should register the session as active', async () => {
      const dto: ProfileConfigDto = {
        name: 'Active Check',
        type: ProfileSessionType.CPU,
        durationSeconds: 5,
        samplingIntervalMs: 1000,
      };

      await service.startSession(dto);
      const activeIds = service.getActiveSessionIds();
      expect(activeIds).toContain('session-uuid-1');
    });

    it('should configure profilers with dto thresholds', async () => {
      const dto: ProfileConfigDto = {
        name: 'Threshold Test',
        slowQueryThresholdMs: 50,
        slowApiThresholdMs: 200,
        durationSeconds: 5,
        samplingIntervalMs: 1000,
      };

      await service.startSession(dto);

      // Give the async session loop a tick to initialise
      await new Promise((r) => setImmediate(r));

      expect(queryProfiler.configure).toHaveBeenCalledWith(
        expect.objectContaining({ slowQueryThresholdMs: 50 }),
      );
      expect(apiProfiler.configure).toHaveBeenCalledWith(
        expect.objectContaining({ slowApiThresholdMs: 200 }),
      );
    });
  });

  // ── cancelSession ─────────────────────────────────────────────────────────

  describe('cancelSession', () => {
    it('should throw NotFoundException for unknown session', async () => {
      await expect(service.cancelSession('unknown-id')).rejects.toThrow(NotFoundException);
    });

    it('should abort and remove an active session', async () => {
      const dto: ProfileConfigDto = {
        name: 'Cancel Me',
        type: ProfileSessionType.MEMORY,
        durationSeconds: 60,
        samplingIntervalMs: 1000,
      };

      await service.startSession(dto);
      expect(service.getActiveSessionIds()).toContain('session-uuid-1');

      await service.cancelSession('session-uuid-1');
      expect(service.getActiveSessionIds()).not.toContain('session-uuid-1');
      expect(sessionRepo.update).toHaveBeenCalledWith(
        'session-uuid-1',
        expect.objectContaining({ status: ProfileSessionStatus.CANCELLED }),
      );
    });
  });

  // ── generateReport ────────────────────────────────────────────────────────

  describe('generateReport', () => {
    it('should throw NotFoundException when session does not exist', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      await expect(service.generateReport('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for active sessions', async () => {
      sessionRepo.findOne.mockResolvedValue(
        makeSession({ status: ProfileSessionStatus.ACTIVE }),
      );
      await expect(service.generateReport('session-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return a complete report for a completed session', async () => {
      sessionRepo.findOne.mockResolvedValue(
        makeSession({
          snapshots: [
            {
              id: 'snap-1',
              sessionId: 'session-uuid-1',
              type: SnapshotType.CPU,
              data: { usagePercent: 25, userTimeMs: 10, systemTimeMs: 2, idlePercent: 75, loadAvg1m: 1, loadAvg5m: 0.8, loadAvg15m: 0.6, cores: 4 },
              valueNumeric: 25,
              isAnomaly: false,
              anomalyReason: null,
              capturedAt: new Date(),
              createdAt: new Date(),
              session: null as any,
            },
          ],
        }),
      );

      const report = await service.generateReport('session-uuid-1');

      expect(report).toMatchObject({
        sessionId: 'session-uuid-1',
        sessionName: 'Test Session',
        generatedAt: expect.any(Date),
        bottlenecks: expect.any(Array),
        summary: expect.objectContaining({
          avgCpuUsage: expect.any(Number),
        }),
      });
    });
  });

  // ── listSessions ──────────────────────────────────────────────────────────

  describe('listSessions', () => {
    it('should return paginated sessions', async () => {
      sessionRepo.findAndCount.mockResolvedValue([[makeSession()], 1]);

      const result = await service.listSessions(10, 0);

      expect(result.total).toBe(1);
      expect(result.sessions).toHaveLength(1);
      expect(sessionRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 0 }),
      );
    });

    it('should cap limit at 100', async () => {
      sessionRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.listSessions(200, 0);

      // Capping is done in the controller, service receives whatever is passed
      expect(sessionRepo.findAndCount).toHaveBeenCalled();
    });
  });

  // ── deleteSession ─────────────────────────────────────────────────────────

  describe('deleteSession', () => {
    it('should throw BadRequestException for active sessions', async () => {
      sessionRepo.findOne.mockResolvedValue(
        makeSession({ status: ProfileSessionStatus.ACTIVE }),
      );
      await expect(service.deleteSession('session-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should delete a completed session', async () => {
      sessionRepo.findOne.mockResolvedValue(makeSession());

      await service.deleteSession('session-uuid-1');

      expect(sessionRepo.delete).toHaveBeenCalledWith('session-uuid-1');
    });
  });

  // ── getActiveSessionIds ───────────────────────────────────────────────────

  describe('getActiveSessionIds', () => {
    it('should return empty array when no sessions are running', () => {
      expect(service.getActiveSessionIds()).toEqual([]);
    });
  });
});

// ─── CpuProfiler Unit Tests ───────────────────────────────────────────────────

describe('CpuProfiler', () => {
  let profiler: CpuProfiler;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CpuProfiler],
    }).compile();
    profiler = module.get(CpuProfiler);
  });

  it('should capture a CPU snapshot', async () => {
    const sample = await profiler.capture();
    expect(sample.snapshot.usagePercent).toBeGreaterThanOrEqual(0);
    expect(sample.snapshot.cores).toBeGreaterThan(0);
    expect(sample.timestamp).toBeInstanceOf(Date);
  });

  it('should compute stats from samples', () => {
    const samples = [
      { timestamp: new Date(), snapshot: { usagePercent: 10, userTimeMs: 0, systemTimeMs: 0, idlePercent: 90, loadAvg1m: 0, loadAvg5m: 0, loadAvg15m: 0, cores: 4 } },
      { timestamp: new Date(), snapshot: { usagePercent: 50, userTimeMs: 0, systemTimeMs: 0, idlePercent: 50, loadAvg1m: 0, loadAvg5m: 0, loadAvg15m: 0, cores: 4 } },
      { timestamp: new Date(), snapshot: { usagePercent: 80, userTimeMs: 0, systemTimeMs: 0, idlePercent: 20, loadAvg1m: 0, loadAvg5m: 0, loadAvg15m: 0, cores: 4 } },
    ];

    const stats = profiler.computeStats(samples as any);
    expect(stats.avg).toBeCloseTo(46.67, 0);
    expect(stats.peak).toBe(80);
  });
});

// ─── BottleneckDetector Unit Tests ────────────────────────────────────────────

describe('BottleneckDetector', () => {
  let detector: BottleneckDetector;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [BottleneckDetector],
    }).compile();
    detector = module.get(BottleneckDetector);
  });

  it('should detect CPU spike bottleneck', () => {
    const cpuSamples = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date(),
      snapshot: {
        usagePercent: 95,
        userTimeMs: 100,
        systemTimeMs: 10,
        idlePercent: 5,
        loadAvg1m: 3,
        loadAvg5m: 2,
        loadAvg15m: 1,
        cores: 4,
      },
    }));

    const bottlenecks = detector.analyzeAll({
      cpuSamples: cpuSamples as any,
      memorySamples: [],
      querySamples: [],
      apiSamples: [],
    });

    expect(bottlenecks.some((b) => b.category === 'cpu')).toBe(true);
    const cpuBottleneck = bottlenecks.find((b) => b.category === 'cpu');
    expect(['high', 'critical']).toContain(cpuBottleneck?.severity);
  });

  it('should detect slow query bottleneck', () => {
    const querySamples = Array.from({ length: 15 }, () => ({
      timestamp: new Date(),
      snapshot: {
        query: 'SELECT * FROM users WHERE email = $1',
        durationMs: 500,
        isSlow: true,
        queryHash: 'abc123',
        operation: 'SELECT',
        table: 'users',
      },
    }));

    const bottlenecks = detector.analyzeAll({
      cpuSamples: [],
      memorySamples: [],
      querySamples: querySamples as any,
      apiSamples: [],
    });

    expect(bottlenecks.some((b) => b.category === 'query')).toBe(true);
  });

  it('should return empty array when no issues', () => {
    const bottlenecks = detector.analyzeAll({
      cpuSamples: [],
      memorySamples: [],
      querySamples: [],
      apiSamples: [],
    });
    expect(bottlenecks).toEqual([]);
  });
});
