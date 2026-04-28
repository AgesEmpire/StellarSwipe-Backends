import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { Repository, DataSource } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';

import { QueryAnalyzerService, SLOW_QUERY_QUEUE } from './query-analyzer.service';
import { SlowQuery, QueryStatus, QueryComplexity } from './entities/slow-query.entity';
import { QueryOptimization, OptimizationStatus } from './entities/query-optimization.entity';
import { ExplainAnalyzer } from './analyzers/explain-analyzer';
import { IndexAnalyzer } from './analyzers/index-analyzer';
import { JoinAnalyzer } from './analyzers/join-analyzer';
import { QueryParser } from './utils/query-parser';
import { SubmitQueryAnalysisDto, BulkQueryIngestionDto } from './dto/query-analysis.dto';
import { IndexType, IndexImpact } from './dto/index-recommendation.dto';
import { OptimizationType, OptimizationPriority } from './entities/query-optimization.entity';

// ─── Factories ────────────────────────────────────────────────────────────────

const makeSlowQuery = (overrides: Partial<SlowQuery> = {}): SlowQuery =>
  ({
    id: 'sq-uuid-1',
    queryText: 'SELECT * FROM users WHERE email = $1',
    queryHash: 'abc123',
    normalizedQuery: "SELECT * FROM USERS WHERE EMAIL = '?'",
    executionTime: 1200,
    avgExecutionTime: 1200,
    executionCount: 1,
    tablesInvolved: ['users'],
    status: QueryStatus.PENDING,
    hasMissingIndexes: false,
    hasSuboptimalJoins: false,
    parameters: ['test@example.com'],
    schemaName: 'public',
    capturedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SlowQuery);

const makeOptimization = (overrides: Partial<QueryOptimization> = {}): QueryOptimization =>
  ({
    id: 'opt-uuid-1',
    slowQueryId: 'sq-uuid-1',
    type: OptimizationType.INDEX,
    priority: OptimizationPriority.HIGH,
    status: OptimizationStatus.SUGGESTED,
    title: 'Add index on users(email)',
    description: 'Sequential scan detected on users table.',
    affectedTable: 'users',
    affectedColumns: ['email'],
    estimatedImprovement: 80,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as QueryOptimization);

// ─── Mock Builders ────────────────────────────────────────────────────────────

function buildMockRepo<T>(): jest.Mocked<Repository<T>> {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    save: jest.fn(),
    create: jest.fn((dto) => dto),
    update: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue({ avg: 500 }),
    }),
  } as any;
}

const mockExplainResult = {
  rawPlan: {},
  parsedPlan: { plan: { totalCost: 500, planRows: 100, startupCost: 0, planWidth: 80, plans: [] } } as any,
  summary: {
    totalCost: 500,
    seqScanCount: 1,
    indexScanCount: 0,
    indexOnlyScanCount: 0,
    hashJoinCount: 0,
    nestedLoopCount: 0,
    mergeSortCount: 0,
    seqScanTables: ['users'],
    missingIndexHints: [{
      table: 'users',
      filter: 'email = ?',
      rowsExamined: 50000,
      rowsReturned: 1,
      filterSelectivity: 0.00002,
    }],
    costlyNodes: [],
    hasParallelWorkers: false,
    maxRows: 50000,
    estimationErrors: [],
    totalSharedBufferHits: 10,
    totalSharedBufferReads: 500,
    isInefficientHashJoin: false,
    planningTimeMs: 1,
    executionTimeMs: 1200,
  },
  complexity: QueryComplexity.MEDIUM,
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('QueryAnalyzerService', () => {
  let service: QueryAnalyzerService;
  let slowQueryRepo: jest.Mocked<Repository<SlowQuery>>;
  let optimizationRepo: jest.Mocked<Repository<QueryOptimization>>;
  let explainAnalyzer: jest.Mocked<ExplainAnalyzer>;
  let indexAnalyzer: jest.Mocked<IndexAnalyzer>;
  let joinAnalyzer: jest.Mocked<JoinAnalyzer>;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    slowQueryRepo = buildMockRepo();
    optimizationRepo = buildMockRepo();
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryAnalyzerService,
        { provide: getRepositoryToken(SlowQuery), useValue: slowQueryRepo },
        { provide: getRepositoryToken(QueryOptimization), useValue: optimizationRepo },
        { provide: getQueueToken(SLOW_QUERY_QUEUE), useValue: queue },
        {
          provide: DataSource,
          useValue: {
            query: jest.fn().mockResolvedValue([]),
            createQueryRunner: jest.fn(),
          },
        },
        {
          provide: ExplainAnalyzer,
          useValue: {
            explain: jest.fn().mockResolvedValue(mockExplainResult),
            explainAnalyze: jest.fn().mockResolvedValue(mockExplainResult),
          },
        },
        {
          provide: IndexAnalyzer,
          useValue: {
            analyze: jest.fn().mockResolvedValue({
              recommendations: [{
                tableName: 'users',
                schemaName: 'public',
                columns: ['email'],
                indexType: IndexType.BTREE,
                impact: IndexImpact.CRITICAL,
                rationale: 'Seq scan on users',
                createStatement: 'CREATE INDEX CONCURRENTLY ...',
                estimatedImprovement: 85,
                existingIndexConflict: false,
                benefitingQueries: [],
              }],
              redundantIndexes: [],
              totalEstimatedGain: 85,
              analyzedAt: new Date(),
            }),
          },
        },
        {
          provide: JoinAnalyzer,
          useValue: { analyze: jest.fn().mockReturnValue([]) },
        },
      ],
    }).compile();

    service = module.get(QueryAnalyzerService);
    explainAnalyzer = module.get(ExplainAnalyzer);
    indexAnalyzer = module.get(IndexAnalyzer);
    joinAnalyzer = module.get(JoinAnalyzer);
  });

  afterEach(() => jest.clearAllMocks());

  // ── submitQuery ────────────────────────────────────────────────────────────

  describe('submitQuery', () => {
    const dto: SubmitQueryAnalysisDto = {
      query: 'SELECT * FROM users WHERE email = $1',
      executionTime: 1200,
      parameters: ['test@example.com'],
      callerService: 'auth-service',
    };

    it('creates a new SlowQuery when hash is not seen before', async () => {
      slowQueryRepo.findOne.mockResolvedValue(null);
      slowQueryRepo.save.mockResolvedValue(makeSlowQuery());

      const result = await service.submitQuery(dto);

      expect(slowQueryRepo.findOne).toHaveBeenCalledWith({ where: { queryHash: expect.any(String) } });
      expect(slowQueryRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        executionTime: 1200,
        callerService: 'auth-service',
        status: QueryStatus.PENDING,
      }));
      expect(slowQueryRepo.save).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith('analyze', expect.objectContaining({ slowQueryId: 'sq-uuid-1' }), expect.any(Object));
    });

    it('increments execution count for duplicate hashes', async () => {
      const existing = makeSlowQuery({ executionCount: 3, avgExecutionTime: 1000 });
      slowQueryRepo.findOne.mockResolvedValue(existing);
      slowQueryRepo.save.mockResolvedValue({ ...existing, executionCount: 4 });

      await service.submitQuery(dto);

      expect(slowQueryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ executionCount: 4, status: QueryStatus.PENDING }),
      );
    });

    it('always enqueues an analysis job', async () => {
      slowQueryRepo.findOne.mockResolvedValue(null);
      slowQueryRepo.save.mockResolvedValue(makeSlowQuery());

      await service.submitQuery(dto);

      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith('analyze', expect.any(Object), expect.objectContaining({ attempts: 3 }));
    });
  });

  // ── submitBulk ─────────────────────────────────────────────────────────────

  describe('submitBulk', () => {
    it('submits all queries and returns count + ids', async () => {
      slowQueryRepo.findOne.mockResolvedValue(null);
      slowQueryRepo.save
        .mockResolvedValueOnce(makeSlowQuery({ id: 'sq-1' }))
        .mockResolvedValueOnce(makeSlowQuery({ id: 'sq-2' }));

      const dto: BulkQueryIngestionDto = {
        queries: [
          { query: 'SELECT 1', executionTime: 100 },
          { query: 'SELECT 2', executionTime: 200 },
        ],
      };

      const result = await service.submitBulk(dto);
      expect(result.submitted).toBe(2);
      expect(result.ids).toHaveLength(2);
    });
  });

  // ── analyzeQuery ───────────────────────────────────────────────────────────

  describe('analyzeQuery', () => {
    it('skips gracefully when slow query not found', async () => {
      slowQueryRepo.findOne.mockResolvedValue(null);
      await service.analyzeQuery('nonexistent-id');
      expect(explainAnalyzer.explain).not.toHaveBeenCalled();
    });

    it('runs full analysis pipeline and persists optimizations', async () => {
      slowQueryRepo.findOne.mockResolvedValue(makeSlowQuery());
      optimizationRepo.save.mockResolvedValue([makeOptimization()]);

      await service.analyzeQuery('sq-uuid-1');

      expect(slowQueryRepo.update).toHaveBeenCalledWith('sq-uuid-1', { status: QueryStatus.ANALYZING });
      expect(explainAnalyzer.explain).toHaveBeenCalledTimes(1);
      expect(indexAnalyzer.analyze).toHaveBeenCalledTimes(1);
      expect(joinAnalyzer.analyze).toHaveBeenCalledTimes(1);
      expect(optimizationRepo.save).toHaveBeenCalled();
      expect(slowQueryRepo.update).toHaveBeenCalledWith('sq-uuid-1', expect.objectContaining({
        status: QueryStatus.OPTIMIZED,
        hasMissingIndexes: true,
      }));
    });

    it('marks status as FAILED if explain throws', async () => {
      slowQueryRepo.findOne.mockResolvedValue(makeSlowQuery());
      jest.spyOn(explainAnalyzer, 'explain').mockRejectedValue(new Error('PG connection refused'));

      await service.analyzeQuery('sq-uuid-1');

      expect(slowQueryRepo.update).toHaveBeenLastCalledWith('sq-uuid-1', expect.objectContaining({
        status: QueryStatus.FAILED,
        analysisError: 'PG connection refused',
      }));
    });

    it('runs explainAnalyze when flag is set', async () => {
      slowQueryRepo.findOne.mockResolvedValue(makeSlowQuery());
      await service.analyzeQuery('sq-uuid-1', true);
      expect(explainAnalyzer.explainAnalyze).toHaveBeenCalledTimes(1);
    });

    it('skips explainAnalyze when flag is false', async () => {
      slowQueryRepo.findOne.mockResolvedValue(makeSlowQuery());
      await service.analyzeQuery('sq-uuid-1', false);
      expect(explainAnalyzer.explainAnalyze).not.toHaveBeenCalled();
    });
  });

  // ── listSlowQueries ────────────────────────────────────────────────────────

  describe('listSlowQueries', () => {
    it('returns paginated results', async () => {
      const sq = makeSlowQuery({ complexity: QueryComplexity.HIGH });
      slowQueryRepo.findAndCount.mockResolvedValue([[sq], 1]);

      const result = await service.listSlowQueries({ page: 1, limit: 10 });

      expect(result.total).toBe(1);
      expect(result.pages).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].complexity).toBe(QueryComplexity.HIGH);
    });
  });

  // ── getSlowQuery ───────────────────────────────────────────────────────────

  describe('getSlowQuery', () => {
    it('returns the record with optimizations', async () => {
      slowQueryRepo.findOne.mockResolvedValue(makeSlowQuery());
      const result = await service.getSlowQuery('sq-uuid-1');
      expect(result.id).toBe('sq-uuid-1');
    });

    it('throws NotFoundException for unknown id', async () => {
      slowQueryRepo.findOne.mockResolvedValue(null);
      await expect(service.getSlowQuery('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── markOptimizationApplied ────────────────────────────────────────────────

  describe('markOptimizationApplied', () => {
    it('sets status to APPLIED with metadata', async () => {
      const opt = makeOptimization();
      optimizationRepo.findOne.mockResolvedValue(opt);
      optimizationRepo.save.mockResolvedValue({ ...opt, status: OptimizationStatus.APPLIED });

      const result = await service.markOptimizationApplied({
        optimizationId: 'opt-uuid-1',
        verifiedImprovement: 78,
        appliedBy: 'xaxxoo',
      });

      expect(optimizationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OptimizationStatus.APPLIED,
          verifiedImprovement: 78,
          appliedBy: 'xaxxoo',
        }),
      );
    });

    it('throws NotFoundException if optimization not found', async () => {
      optimizationRepo.findOne.mockResolvedValue(null);
      await expect(
        service.markOptimizationApplied({ optimizationId: 'ghost' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

// ─── QueryParser Unit Tests ───────────────────────────────────────────────────

describe('QueryParser', () => {
  it('normalises string literals and numbers', () => {
    const { normalizedSql } = QueryParser.parse("SELECT * FROM users WHERE id = 42 AND email = 'foo@bar.com'");
    expect(normalizedSql).not.toContain('42');
    expect(normalizedSql).not.toContain('foo@bar.com');
  });

  it('detects SELECT type', () => {
    expect(QueryParser.parse('SELECT 1').type).toBe('SELECT');
  });

  it('extracts table names from FROM and JOIN', () => {
    const { tables } = QueryParser.parse(
      'SELECT u.id FROM users u JOIN orders o ON u.id = o.user_id',
    );
    expect(tables).toContain('users');
    expect(tables).toContain('orders');
  });

  it('counts joins correctly', () => {
    const { joinCount } = QueryParser.parse(
      'SELECT * FROM a JOIN b ON a.id = b.aid LEFT JOIN c ON b.id = c.bid',
    );
    expect(joinCount).toBe(2);
  });

  it('detects subquery presence', () => {
    const { hasSubquery } = QueryParser.parse(
      'SELECT * FROM users WHERE id IN (SELECT user_id FROM banned)',
    );
    expect(hasSubquery).toBe(true);
  });

  it('produces consistent hash for same query', () => {
    const q = "SELECT id FROM products WHERE price > 100";
    expect(QueryParser.parse(q).hash).toBe(QueryParser.parse(q).hash);
  });

  it('produces different hashes for different queries', () => {
    const a = QueryParser.parse('SELECT 1').hash;
    const b = QueryParser.parse('SELECT 2').hash;
    expect(a).not.toBe(b);
  });

  it('computes higher complexity score for multi-join queries', () => {
    const simple = QueryParser.parse('SELECT id FROM users').estimatedComplexity;
    const complex = QueryParser.parse(
      'SELECT u.*, o.*, p.* FROM users u JOIN orders o ON u.id = o.uid JOIN payments p ON o.id = p.oid LEFT JOIN refunds r ON p.id = r.pid',
    ).estimatedComplexity;
    expect(complex).toBeGreaterThan(simple);
  });
});
