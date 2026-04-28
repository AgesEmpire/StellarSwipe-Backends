import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Between, FindManyOptions } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { SlowQuery, QueryStatus, QueryComplexity } from './entities/slow-query.entity';
import {
  QueryOptimization,
  OptimizationType,
  OptimizationPriority,
  OptimizationStatus,
} from './entities/query-optimization.entity';
import { ExplainAnalyzer } from './analyzers/explain-analyzer';
import { IndexAnalyzer } from './analyzers/index-analyzer';
import { JoinAnalyzer } from './analyzers/join-analyzer';
import { QueryParser } from './utils/query-parser';
import {
  SubmitQueryAnalysisDto,
  BulkQueryIngestionDto,
  QueryFilterDto,
  MarkOptimizationAppliedDto,
  QueryAnalysisResultDto,
} from './dto/query-analysis.dto';
import {
  OptimizationSuggestionDto,
  OptimizationFilterDto,
  CreateOptimizationDto,
} from './dto/optimization-suggestion.dto';
import { IndexAnalysisReportDto } from './dto/index-recommendation.dto';

export const SLOW_QUERY_QUEUE = 'slow-query-analysis';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

@Injectable()
export class QueryAnalyzerService {
  private readonly logger = new Logger(QueryAnalyzerService.name);

  constructor(
    @InjectRepository(SlowQuery)
    private readonly slowQueryRepo: Repository<SlowQuery>,
    @InjectRepository(QueryOptimization)
    private readonly optimizationRepo: Repository<QueryOptimization>,
    private readonly dataSource: DataSource,
    private readonly explainAnalyzer: ExplainAnalyzer,
    private readonly indexAnalyzer: IndexAnalyzer,
    private readonly joinAnalyzer: JoinAnalyzer,
    @InjectQueue(SLOW_QUERY_QUEUE)
    private readonly analysisQueue: Queue,
  ) {}

  // ─── Submit ────────────────────────────────────────────────────────────────

  async submitQuery(dto: SubmitQueryAnalysisDto): Promise<SlowQuery> {
    const parsed = QueryParser.parse(dto.query);

    // Upsert by query hash — increment count if seen before
    let record = await this.slowQueryRepo.findOne({
      where: { queryHash: parsed.hash },
    });

    if (record) {
      record.executionCount += 1;
      record.avgExecutionTime =
        ((record.avgExecutionTime ?? record.executionTime) * (record.executionCount - 1) +
          (dto.executionTime ?? 0)) /
        record.executionCount;
      record.status = QueryStatus.PENDING;
      record = await this.slowQueryRepo.save(record);
    } else {
      record = await this.slowQueryRepo.save(
        this.slowQueryRepo.create({
          queryText: dto.query,
          queryHash: parsed.hash,
          normalizedQuery: parsed.normalizedSql,
          executionTime: dto.executionTime ?? 0,
          avgExecutionTime: dto.executionTime ?? 0,
          parameters: dto.parameters ?? null,
          databaseName: dto.databaseName ?? null,
          schemaName: dto.schemaName ?? 'public',
          callerService: dto.callerService ?? null,
          callerEndpoint: dto.callerEndpoint ?? null,
          tablesInvolved: parsed.tables,
          status: QueryStatus.PENDING,
          capturedAt: new Date(),
        }),
      );
    }

    // Enqueue analysis
    await this.analysisQueue.add(
      'analyze',
      {
        slowQueryId: record.id,
        runExplainAnalyze: dto.runExplainAnalyze ?? false,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true },
    );

    return record;
  }

  async submitBulk(dto: BulkQueryIngestionDto): Promise<{ submitted: number; ids: string[] }> {
    const results = await Promise.allSettled(
      dto.queries.map((q) => this.submitQuery(q)),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<SlowQuery>[];
    return {
      submitted: succeeded.length,
      ids: succeeded.map((r) => r.value.id),
    };
  }

  // ─── Analysis (called by the BullMQ job) ──────────────────────────────────

  async analyzeQuery(slowQueryId: string, runExplainAnalyze = false): Promise<void> {
    const record = await this.slowQueryRepo.findOne({ where: { id: slowQueryId } });
    if (!record) {
      this.logger.warn(`SlowQuery ${slowQueryId} not found, skipping`);
      return;
    }

    await this.slowQueryRepo.update(slowQueryId, { status: QueryStatus.ANALYZING });

    try {
      const parsed = QueryParser.parse(record.queryText);

      // --- EXPLAIN ---
      const explainResult = await this.explainAnalyzer
        .explain(record.queryText, record.parameters ?? [])
        .catch((err) => {
          this.logger.warn(`EXPLAIN failed for ${slowQueryId}`, err.message);
          return null;
        });

      // --- EXPLAIN ANALYZE (optional) ---
      const explainAnalyzeResult = runExplainAnalyze
        ? await this.explainAnalyzer
            .explainAnalyze(record.queryText, record.parameters ?? [])
            .catch(() => null)
        : null;

      const planSummary = explainResult?.summary;

      // --- Index Analysis ---
      const indexReport = planSummary
        ? await this.indexAnalyzer.analyze(parsed, planSummary, record.schemaName ?? 'public')
        : null;

      // --- Join Analysis ---
      const joinOptimizations = planSummary
        ? this.joinAnalyzer.analyze(parsed, planSummary, slowQueryId)
        : [];

      // --- Persist optimizations ---
      const optimizations: QueryOptimization[] = [];

      if (indexReport) {
        for (const rec of indexReport.recommendations) {
          optimizations.push(
            this.optimizationRepo.create({
              slowQueryId,
              type: OptimizationType.INDEX,
              priority: this.impactToPriority(rec.impact as any),
              title: `Add index on ${rec.tableName}(${rec.columns.join(', ')})`,
              description: rec.rationale,
              sqlStatement: rec.createStatement,
              estimatedImprovement: rec.estimatedImprovement,
              affectedTable: rec.tableName,
              affectedColumns: rec.columns,
              metadata: {
                indexType: rec.indexType,
                storageEstimateMb: rec.estimatedStorageMb,
                existingConflict: rec.existingIndexConflict,
              },
            }),
          );
        }
      }

      for (const joinDto of joinOptimizations) {
        optimizations.push(this.optimizationRepo.create(joinDto));
      }

      if (optimizations.length > 0) {
        await this.optimizationRepo.save(optimizations);
      }

      // --- Query rewrite suggestion if high cost ---
      if (planSummary && planSummary.totalCost > 10_000) {
        await this.suggestQueryRewrite(record, parsed, slowQueryId);
      }

      // --- Update slow query record ---
      await this.slowQueryRepo.update(slowQueryId, {
        status: QueryStatus.OPTIMIZED,
        complexity:
          explainResult?.complexity ??
          this.scoreToComplexity(parsed.estimatedComplexity),
        explainOutput: explainResult?.rawPlan ?? null,
        explainAnalyzeOutput: explainAnalyzeResult?.rawPlan ?? null,
        totalCost: planSummary?.totalCost ?? null,
        seqScans: planSummary?.seqScanCount ?? null,
        indexScans: planSummary?.indexScanCount ?? null,
        hasMissingIndexes: (indexReport?.recommendations.length ?? 0) > 0,
        hasSuboptimalJoins: joinOptimizations.length > 0,
      });
    } catch (error) {
      this.logger.error(`Analysis failed for ${slowQueryId}`, error);
      await this.slowQueryRepo.update(slowQueryId, {
        status: QueryStatus.FAILED,
        analysisError: (error as Error).message,
      });
    }
  }

  // ─── Index Report ──────────────────────────────────────────────────────────

  async getIndexReport(slowQueryId: string): Promise<IndexAnalysisReportDto> {
    const record = await this.findSlowQueryOrThrow(slowQueryId);
    const parsed = QueryParser.parse(record.queryText);
    const explainResult = await this.explainAnalyzer
      .explain(record.queryText, record.parameters ?? [])
      .catch(() => null);

    if (!explainResult) {
      throw new BadRequestException('Could not run EXPLAIN for this query.');
    }

    return this.indexAnalyzer.analyze(
      parsed,
      explainResult.summary,
      record.schemaName ?? 'public',
    );
  }

  // ─── Queries List ──────────────────────────────────────────────────────────

  async listSlowQueries(
    filter: QueryFilterDto,
  ): Promise<PaginatedResult<QueryAnalysisResultDto>> {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: FindManyOptions<SlowQuery>['where'] = {};
    if (filter.complexity) (where as any).complexity = filter.complexity;
    if (filter.callerService) (where as any).callerService = filter.callerService;
    if (filter.hasMissingIndexes !== undefined)
      (where as any).hasMissingIndexes = filter.hasMissingIndexes;
    if (filter.from && filter.to)
      (where as any).capturedAt = Between(
        new Date(filter.from),
        new Date(filter.to),
      );

    const [rows, total] = await this.slowQueryRepo.findAndCount({
      where,
      order: { executionTime: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data: rows.map(this.toResultDto),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async getSlowQuery(id: string): Promise<SlowQuery> {
    return this.findSlowQueryOrThrow(id);
  }

  // ─── Optimizations ─────────────────────────────────────────────────────────

  async listOptimizations(
    filter: OptimizationFilterDto,
  ): Promise<OptimizationSuggestionDto[]> {
    const where: any = {};
    if (filter.type) where.type = filter.type;
    if (filter.priority) where.priority = filter.priority;
    if (filter.status) where.status = filter.status;
    if (filter.slowQueryId) where.slowQueryId = filter.slowQueryId;

    const rows = await this.optimizationRepo.find({
      where,
      order: { priority: 'DESC', createdAt: 'DESC' },
    });

    return rows.map(this.toSuggestionDto);
  }

  async markOptimizationApplied(
    dto: MarkOptimizationAppliedDto,
  ): Promise<OptimizationSuggestionDto> {
    const opt = await this.optimizationRepo.findOne({
      where: { id: dto.optimizationId },
    });
    if (!opt) throw new NotFoundException(`Optimization ${dto.optimizationId} not found`);

    opt.status = OptimizationStatus.APPLIED;
    opt.appliedAt = new Date();
    opt.appliedBy = dto.appliedBy ?? null;
    opt.verifiedImprovement = dto.verifiedImprovement ?? null;
    await this.optimizationRepo.save(opt);

    return this.toSuggestionDto(opt);
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  async getDashboardStats() {
    const [total, byStatus, avgTime, topTables] = await Promise.all([
      this.slowQueryRepo.count(),
      this.slowQueryRepo
        .createQueryBuilder('sq')
        .select('sq.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('sq.status')
        .getRawMany(),
      this.slowQueryRepo
        .createQueryBuilder('sq')
        .select('AVG(sq.executionTime)', 'avg')
        .getRawOne(),
      this.dataSource.query(`
        SELECT unnest(tables_involved) AS table_name, COUNT(*) AS freq
        FROM slow_queries
        GROUP BY table_name
        ORDER BY freq DESC
        LIMIT 10
      `),
    ]);

    return { total, byStatus, avgExecutionTime: avgTime?.avg ?? 0, topTables };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private async suggestQueryRewrite(
    record: SlowQuery,
    parsed: any,
    slowQueryId: string,
  ) {
    const suggestions: CreateOptimizationDto[] = [];

    if (parsed.hasSubquery) {
      suggestions.push({
        slowQueryId,
        type: OptimizationType.QUERY_REWRITE,
        priority: OptimizationPriority.HIGH,
        title: 'Convert correlated subquery to JOIN or CTE',
        description:
          'A correlated subquery was detected. These execute once per outer row and can be 10–100× slower than an equivalent JOIN or lateral join.',
        rewrittenQuery: `-- Consider rewriting as:\nWITH subquery_cte AS (\n  -- move the subquery body here\n)\nSELECT ... FROM ${record.tablesInvolved[0] ?? 'table'}\nJOIN subquery_cte ON ...`,
        estimatedImprovement: 60,
        metadata: { originalTables: parsed.tables },
      });
    }

    if (parsed.hasDistinct && !parsed.hasGroupBy) {
      suggestions.push({
        slowQueryId,
        type: OptimizationType.QUERY_REWRITE,
        priority: OptimizationPriority.MEDIUM,
        title: 'Replace DISTINCT with GROUP BY or EXISTS',
        description:
          'DISTINCT forces a full sort of the result set. For de-duplication across joined tables, consider EXISTS or a GROUP BY to allow index-only scans.',
        estimatedImprovement: 25,
      });
    }

    if (suggestions.length > 0) {
      await this.optimizationRepo.save(
        suggestions.map((s) => this.optimizationRepo.create(s)),
      );
    }
  }

  private async findSlowQueryOrThrow(id: string): Promise<SlowQuery> {
    const record = await this.slowQueryRepo.findOne({
      where: { id },
      relations: ['optimizations'],
    });
    if (!record) throw new NotFoundException(`SlowQuery ${id} not found`);
    return record;
  }

  private impactToPriority(impact: string): OptimizationPriority {
    const map: Record<string, OptimizationPriority> = {
      critical: OptimizationPriority.CRITICAL,
      high: OptimizationPriority.HIGH,
      medium: OptimizationPriority.MEDIUM,
      low: OptimizationPriority.LOW,
    };
    return map[impact] ?? OptimizationPriority.MEDIUM;
  }

  private scoreToComplexity(score: number): QueryComplexity {
    if (score >= 40) return QueryComplexity.CRITICAL;
    if (score >= 20) return QueryComplexity.HIGH;
    if (score >= 8) return QueryComplexity.MEDIUM;
    return QueryComplexity.LOW;
  }

  private toResultDto(sq: SlowQuery): QueryAnalysisResultDto {
    return {
      id: sq.id,
      queryHash: sq.queryHash,
      normalizedQuery: sq.normalizedQuery ?? sq.queryText,
      executionTime: sq.executionTime,
      complexity: sq.complexity as any,
      tablesInvolved: sq.tablesInvolved,
      seqScans: sq.seqScans ?? 0,
      indexScans: sq.indexScans ?? 0,
      totalCost: sq.totalCost ?? 0,
      hasMissingIndexes: sq.hasMissingIndexes,
      hasSuboptimalJoins: sq.hasSuboptimalJoins,
      status: sq.status,
      analyzedAt: sq.updatedAt,
    };
  }

  private toSuggestionDto(opt: QueryOptimization): OptimizationSuggestionDto {
    return {
      id: opt.id,
      slowQueryId: opt.slowQueryId,
      type: opt.type,
      priority: opt.priority,
      status: opt.status,
      title: opt.title,
      description: opt.description,
      sqlStatement: opt.sqlStatement ?? undefined,
      rewrittenQuery: opt.rewrittenQuery ?? undefined,
      estimatedImprovement: opt.estimatedImprovement ?? undefined,
      estimatedTimeSavedMs: opt.estimatedTimeSavedMs ?? undefined,
      affectedTable: opt.affectedTable ?? undefined,
      affectedColumns: opt.affectedColumns,
      metadata: opt.metadata ?? undefined,
      createdAt: opt.createdAt,
    };
  }
}
