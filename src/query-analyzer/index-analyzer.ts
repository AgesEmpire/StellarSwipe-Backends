import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PlanSummary, MissingIndexHint } from '../utils/execution-plan-reader';
import { ParsedQuery } from '../utils/query-parser';
import {
  IndexRecommendationDto,
  IndexType,
  IndexImpact,
  RedundantIndexDto,
  IndexAnalysisReportDto,
} from '../dto/index-recommendation.dto';

interface ExistingIndex {
  indexName: string;
  tableName: string;
  schemaName: string;
  columns: string[];
  isUnique: boolean;
  indexType: string;
  indexSize: string;
  scansCount: number;
  tuplesFetched: number;
}

@Injectable()
export class IndexAnalyzer {
  private readonly logger = new Logger(IndexAnalyzer.name);

  constructor(private readonly dataSource: DataSource) {}

  // ─── Main Entry Point ────────────────────────────────────────────────────────

  async analyze(
    parsedQuery: ParsedQuery,
    planSummary: PlanSummary,
    schema = 'public',
  ): Promise<IndexAnalysisReportDto> {
    const existingIndexes = await this.fetchExistingIndexes(
      parsedQuery.tables,
      schema,
    );
    const recommendations = this.buildRecommendations(
      parsedQuery,
      planSummary,
      existingIndexes,
      schema,
    );
    const redundantIndexes = await this.detectRedundantIndexes(
      parsedQuery.tables,
      schema,
      existingIndexes,
    );
    const totalEstimatedGain = recommendations.reduce(
      (sum, r) => sum + (r.estimatedImprovement ?? 0),
      0,
    );

    return {
      recommendations,
      redundantIndexes,
      totalEstimatedGain: Math.min(totalEstimatedGain, 95),
      analyzedAt: new Date(),
    };
  }

  // ─── Recommendation Builder ───────────────────────────────────────────────────

  private buildRecommendations(
    parsedQuery: ParsedQuery,
    planSummary: PlanSummary,
    existingIndexes: ExistingIndex[],
    schema: string,
  ): IndexRecommendationDto[] {
    const recs: IndexRecommendationDto[] = [];

    // 1. Seq-scan tables with filter conditions → suggest B-tree
    for (const hint of planSummary.missingIndexHints) {
      const columns = this.extractColumnsFromFilter(hint.filter);
      if (columns.length === 0) continue;

      const conflict = this.findConflictingIndex(existingIndexes, hint.table, columns);
      const impact = this.rateImpact(hint.filterSelectivity, hint.rowsExamined);

      recs.push({
        tableName: hint.table,
        schemaName: schema,
        columns,
        indexType: IndexType.BTREE,
        impact,
        rationale: `Sequential scan on "${hint.table}" examined ${hint.rowsExamined.toLocaleString()} rows but only returned ${hint.rowsReturned.toLocaleString()} (${(hint.filterSelectivity * 100).toFixed(1)}% selectivity). Adding an index on (${columns.join(', ')}) will allow the planner to use an index scan instead.`,
        createStatement: this.buildCreateStatement(hint.table, columns, schema),
        estimatedImprovement: this.estimateImprovement(hint.filterSelectivity),
        estimatedStorageMb: this.estimateIndexSize(hint.rowsExamined, columns.length),
        existingIndexConflict: !!conflict,
        conflictingIndexName: conflict?.indexName,
        benefitingQueries: [parsedQuery.normalizedSql.substring(0, 120)],
      });
    }

    // 2. High-cost nested loops → suggest composite index
    if (planSummary.nestedLoopCount > 0 && parsedQuery.joinCount > 0) {
      for (const table of parsedQuery.tables) {
        const potentialJoinCols = this.inferJoinColumns(
          parsedQuery.normalizedSql,
          table,
        );
        if (potentialJoinCols.length > 0) {
          const conflict = this.findConflictingIndex(existingIndexes, table, potentialJoinCols);
          if (!conflict) {
            recs.push({
              tableName: table,
              schemaName: schema,
              columns: potentialJoinCols,
              indexType: IndexType.BTREE,
              impact: IndexImpact.HIGH,
              rationale: `Nested loop join on "${table}" detected. A B-tree index on join key columns (${potentialJoinCols.join(', ')}) will eliminate the inner full scan.`,
              createStatement: this.buildCreateStatement(table, potentialJoinCols, schema),
              estimatedImprovement: 45,
              existingIndexConflict: false,
              benefitingQueries: [parsedQuery.normalizedSql.substring(0, 120)],
            });
          }
        }
      }
    }

    // 3. DISTINCT / ORDER BY → covering index suggestion
    if (parsedQuery.hasOrderBy && parsedQuery.hasDistinct) {
      const primaryTable = parsedQuery.tables[0];
      if (primaryTable && parsedQuery.columns.length > 0 && parsedQuery.columns[0] !== '*') {
        recs.push({
          tableName: primaryTable,
          schemaName: schema,
          columns: parsedQuery.columns.slice(0, 2),
          includeColumns: parsedQuery.columns.slice(2, 5),
          indexType: IndexType.COVERING,
          impact: IndexImpact.MEDIUM,
          rationale: `DISTINCT + ORDER BY forces a Sort node. A covering index on (${parsedQuery.columns.slice(0, 2).join(', ')}) INCLUDE (${parsedQuery.columns.slice(2, 5).join(', ')}) avoids the sort entirely.`,
          createStatement: this.buildCoveringStatement(
            primaryTable,
            parsedQuery.columns.slice(0, 2),
            parsedQuery.columns.slice(2, 5),
            schema,
          ),
          estimatedImprovement: 25,
          existingIndexConflict: false,
        });
      }
    }

    return recs;
  }

  // ─── Fetch Existing Indexes ───────────────────────────────────────────────────

  private async fetchExistingIndexes(
    tables: string[],
    schema: string,
  ): Promise<ExistingIndex[]> {
    if (tables.length === 0) return [];

    try {
      const rows = await this.dataSource.query(
        `
        SELECT
          i.relname                              AS "indexName",
          t.relname                              AS "tableName",
          n.nspname                              AS "schemaName",
          ix.indisunique                         AS "isUnique",
          am.amname                              AS "indexType",
          pg_size_pretty(pg_relation_size(i.oid)) AS "indexSize",
          COALESCE(s.idx_scan, 0)                AS "scansCount",
          COALESCE(s.idx_tup_fetch, 0)           AS "tuplesFetched",
          ARRAY(
            SELECT a.attname
            FROM   pg_attribute a
            WHERE  a.attrelid = t.oid
              AND  a.attnum = ANY(ix.indkey)
            ORDER  BY array_position(ix.indkey, a.attnum)
          )                                      AS "columns"
        FROM   pg_index   ix
        JOIN   pg_class   i  ON i.oid  = ix.indexrelid
        JOIN   pg_class   t  ON t.oid  = ix.indrelid
        JOIN   pg_am      am ON am.oid = i.relam
        JOIN   pg_namespace n ON n.oid = t.relnamespace
        LEFT JOIN pg_stat_user_indexes s
               ON s.indexrelid = ix.indexrelid
        WHERE  n.nspname = $1
          AND  t.relname = ANY($2::text[])
        ORDER  BY t.relname, i.relname
        `,
        [schema, tables],
      );
      return rows as ExistingIndex[];
    } catch (err) {
      this.logger.warn('Failed to fetch existing indexes', err);
      return [];
    }
  }

  // ─── Redundant Index Detection ────────────────────────────────────────────────

  private async detectRedundantIndexes(
    tables: string[],
    schema: string,
    existingIndexes: ExistingIndex[],
  ): Promise<RedundantIndexDto[]> {
    const redundant: RedundantIndexDto[] = [];

    for (const idx of existingIndexes) {
      if (idx.scansCount === 0 && idx.tuplesFetched === 0) {
        redundant.push({
          indexName: idx.indexName,
          tableName: idx.tableName,
          columns: idx.columns,
          reason: 'Zero scans recorded since statistics reset — index may be unused.',
          dropStatement: `DROP INDEX CONCURRENTLY "${schema}"."${idx.indexName}";`,
        });
        continue;
      }

      // Detect subset indexes (prefix covered by a wider index)
      const superseder = existingIndexes.find(
        (other) =>
          other.indexName !== idx.indexName &&
          other.tableName === idx.tableName &&
          idx.columns.every((c, i) => other.columns[i] === c) &&
          other.columns.length > idx.columns.length,
      );

      if (superseder) {
        redundant.push({
          indexName: idx.indexName,
          tableName: idx.tableName,
          columns: idx.columns,
          reason: `This index is a leading-column prefix of "${superseder.indexName}" and is fully superseded by it.`,
          dropStatement: `DROP INDEX CONCURRENTLY "${schema}"."${idx.indexName}";`,
          supersededBy: superseder.indexName,
        });
      }
    }

    return redundant;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private extractColumnsFromFilter(filter: string): string[] {
    if (!filter) return [];
    const matches = filter.match(/\b([a-z_][a-z0-9_]*)\s*(?:=|<|>|<=|>=|<>|IS\s+NULL|LIKE)/gi) ?? [];
    return [...new Set(matches.map((m) => m.split(/\s/)[0].toLowerCase()))];
  }

  private inferJoinColumns(normalizedSql: string, table: string): string[] {
    const onPattern = new RegExp(
      `${table.toUpperCase()}\\s*\\.\\s*([A-Z0-9_]+)\\s*=`,
      'g',
    );
    const cols: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = onPattern.exec(normalizedSql)) !== null) {
      cols.push(m[1].toLowerCase());
    }
    return [...new Set(cols)].slice(0, 3);
  }

  private findConflictingIndex(
    existing: ExistingIndex[],
    table: string,
    columns: string[],
  ): ExistingIndex | undefined {
    return existing.find(
      (idx) =>
        idx.tableName === table &&
        columns.every((c, i) => idx.columns[i] === c),
    );
  }

  private rateImpact(selectivity: number, rowsExamined: number): IndexImpact {
    if (selectivity < 0.01 && rowsExamined > 10_000) return IndexImpact.CRITICAL;
    if (selectivity < 0.05 && rowsExamined > 1_000) return IndexImpact.HIGH;
    if (selectivity < 0.2) return IndexImpact.MEDIUM;
    return IndexImpact.LOW;
  }

  private estimateImprovement(selectivity: number): number {
    if (selectivity < 0.01) return 90;
    if (selectivity < 0.05) return 75;
    if (selectivity < 0.1) return 55;
    if (selectivity < 0.2) return 35;
    return 15;
  }

  private estimateIndexSize(rows: number, colCount: number): number {
    // Very rough: 50 bytes per row per column + 30% overhead
    return Math.round((rows * colCount * 50 * 1.3) / 1_048_576);
  }

  private buildCreateStatement(
    table: string,
    columns: string[],
    schema: string,
  ): string {
    const indexName = `idx_${table}_${columns.join('_')}`.substring(0, 63);
    return `CREATE INDEX CONCURRENTLY "${indexName}" ON "${schema}"."${table}" (${columns.map((c) => `"${c}"`).join(', ')});`;
  }

  private buildCoveringStatement(
    table: string,
    columns: string[],
    include: string[],
    schema: string,
  ): string {
    const indexName = `idx_${table}_${columns.join('_')}_cover`.substring(0, 63);
    const incClause = include.length
      ? ` INCLUDE (${include.map((c) => `"${c}"`).join(', ')})`
      : '';
    return `CREATE INDEX CONCURRENTLY "${indexName}" ON "${schema}"."${table}" (${columns.map((c) => `"${c}"`).join(', ')})${incClause};`;
  }
}
