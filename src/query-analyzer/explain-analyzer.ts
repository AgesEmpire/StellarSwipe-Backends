import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ExecutionPlanReader,
  ExecutionPlan,
  PlanSummary,
} from '../utils/execution-plan-reader';
import { QueryComplexity } from '../entities/slow-query.entity';

export interface ExplainResult {
  rawPlan: Record<string, any>;
  parsedPlan: ExecutionPlan;
  summary: PlanSummary;
  complexity: QueryComplexity;
}

@Injectable()
export class ExplainAnalyzer {
  private readonly logger = new Logger(ExplainAnalyzer.name);

  constructor(private readonly dataSource: DataSource) {}

  // ─── Run EXPLAIN (no execution) ──────────────────────────────────────────────

  async explain(sql: string, params: any[] = []): Promise<ExplainResult> {
    const safeSql = this.buildExplainSql(sql, false);
    return this.runAndParse(safeSql, params);
  }

  // ─── Run EXPLAIN ANALYZE (executes query!) ────────────────────────────────

  async explainAnalyze(sql: string, params: any[] = []): Promise<ExplainResult> {
    const safeSql = this.buildExplainSql(sql, true);
    return this.runAndParse(safeSql, params);
  }

  // ─── Complexity Mapping ───────────────────────────────────────────────────

  static mapComplexity(summary: PlanSummary, executionTimeMs: number): QueryComplexity {
    if (
      executionTimeMs > 5000 ||
      summary.seqScanCount > 3 ||
      summary.totalCost > 100_000
    ) {
      return QueryComplexity.CRITICAL;
    }
    if (
      executionTimeMs > 1000 ||
      summary.seqScanCount > 1 ||
      summary.totalCost > 10_000 ||
      summary.nestedLoopCount > 2
    ) {
      return QueryComplexity.HIGH;
    }
    if (
      executionTimeMs > 200 ||
      summary.hashJoinCount > 0 ||
      summary.totalCost > 1_000
    ) {
      return QueryComplexity.MEDIUM;
    }
    return QueryComplexity.LOW;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private buildExplainSql(sql: string, analyze: boolean): string {
    const opts = [
      'FORMAT JSON',
      'VERBOSE true',
      'COSTS true',
      'BUFFERS true',
      analyze ? 'ANALYZE true' : null,
      analyze ? 'TIMING true' : null,
    ]
      .filter(Boolean)
      .join(', ');
    return `EXPLAIN (${opts}) ${sql}`;
  }

  private async runAndParse(
    explainSql: string,
    params: any[],
  ): Promise<ExplainResult> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      await queryRunner.startTransaction('READ COMMITTED');
      const rows: Array<{ 'QUERY PLAN': any }> = await queryRunner.query(
        explainSql,
        params,
      );
      await queryRunner.rollbackTransaction(); // Never persist EXPLAIN ANALYZE changes

      const rawPlan = rows[0]['QUERY PLAN'];
      const parsedPlan = ExecutionPlanReader.parsePlanJson(rawPlan);
      const summary = ExecutionPlanReader.summarize(parsedPlan);
      const complexity = ExplainAnalyzer.mapComplexity(
        summary,
        parsedPlan.executionTime ?? 0,
      );

      return { rawPlan, parsedPlan, summary, complexity };
    } catch (error) {
      this.logger.error('EXPLAIN failed', { sql: explainSql, error });
      await queryRunner.rollbackTransaction().catch(() => {});
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
