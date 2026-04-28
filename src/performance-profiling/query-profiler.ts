import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { QuerySnapshot } from '../entities/performance-snapshot.entity';

export interface QuerySample {
  timestamp: Date;
  snapshot: QuerySnapshot;
}

export interface QueryProfilerConfig {
  slowQueryThresholdMs: number;
  captureExplain: boolean;
}

/**
 * TypeORM-compatible logger interface.
 * Register as a custom logger in TypeORM DataSource options.
 */
export interface TypeOrmQueryLogger {
  logQuery(query: string, parameters?: any[], queryRunner?: any): void;
  logQuerySlow(time: number, query: string, parameters?: any[], queryRunner?: any): void;
  logQueryError(error: string | Error, query: string, parameters?: any[]): void;
  logSchemaBuild(message: string): void;
  logMigration(message: string): void;
  log(level: 'log' | 'info' | 'warn', message: any): void;
}

@Injectable()
export class QueryProfiler {
  private readonly logger = new Logger(QueryProfiler.name);
  private samples: QuerySample[] = [];
  private active = false;
  private config: QueryProfilerConfig = {
    slowQueryThresholdMs: 100,
    captureExplain: false,
  };

  // Map of queryHash → start time for duration tracking
  private pendingQueries = new Map<string, number>();

  configure(config: Partial<QueryProfilerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  startRecording(): void {
    this.active = true;
    this.samples = [];
    this.pendingQueries.clear();
    this.logger.debug('Query profiler recording started');
  }

  stopRecording(): QuerySample[] {
    this.active = false;
    this.logger.debug(`Query profiler stopped. Captured ${this.samples.length} samples`);
    return [...this.samples];
  }

  /**
   * Call this BEFORE executing a query to record start time.
   */
  onQueryStart(query: string): string {
    const traceId = crypto.randomUUID();
    if (this.active) {
      this.pendingQueries.set(traceId, performance.now());
    }
    return traceId;
  }

  /**
   * Call this AFTER the query completes.
   */
  onQueryEnd(traceId: string, query: string, rowsReturned?: number): void {
    if (!this.active) return;

    const start = this.pendingQueries.get(traceId);
    if (start === undefined) return;

    const durationMs = Math.round((performance.now() - start) * 100) / 100;
    this.pendingQueries.delete(traceId);

    const snapshot = this.buildSnapshot(query, durationMs, rowsReturned);
    this.samples.push({ timestamp: new Date(), snapshot });
  }

  /**
   * Directly record a completed query with known duration (e.g. from TypeORM slow logger).
   */
  recordQuery(query: string, durationMs: number, rowsReturned?: number): void {
    if (!this.active) return;
    const snapshot = this.buildSnapshot(query, durationMs, rowsReturned);
    this.samples.push({ timestamp: new Date(), snapshot });
  }

  private buildSnapshot(
    query: string,
    durationMs: number,
    rowsReturned?: number,
  ): QuerySnapshot {
    const normalised = query.trim().replace(/\s+/g, ' ').substring(0, 2000);
    const queryHash = crypto
      .createHash('md5')
      .update(normalised)
      .digest('hex')
      .substring(0, 12);

    const operation = this.detectOperation(normalised);
    const table = this.extractTable(normalised, operation);

    return {
      query: normalised,
      durationMs,
      rowsReturned,
      isSlow: durationMs >= this.config.slowQueryThresholdMs,
      queryHash,
      table,
      operation,
    };
  }

  private detectOperation(
    query: string,
  ): 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'OTHER' {
    const upper = query.toUpperCase().trimStart();
    if (upper.startsWith('SELECT')) return 'SELECT';
    if (upper.startsWith('INSERT')) return 'INSERT';
    if (upper.startsWith('UPDATE')) return 'UPDATE';
    if (upper.startsWith('DELETE')) return 'DELETE';
    return 'OTHER';
  }

  private extractTable(query: string, op: string): string | undefined {
    try {
      const patterns: Record<string, RegExp> = {
        SELECT: /FROM\s+"?(\w+)"?/i,
        INSERT: /INTO\s+"?(\w+)"?/i,
        UPDATE: /UPDATE\s+"?(\w+)"?/i,
        DELETE: /FROM\s+"?(\w+)"?/i,
      };
      const match = query.match(patterns[op] ?? /FROM\s+"?(\w+)"?/i);
      return match?.[1];
    } catch {
      return undefined;
    }
  }

  aggregateSlowQueries(samples: QuerySample[]): Array<{
    queryHash: string;
    query: string;
    avgDurationMs: number;
    maxDurationMs: number;
    count: number;
    table?: string;
    operation: string;
    recommendation: string;
  }> {
    const map = new Map<
      string,
      { query: string; durations: number[]; table?: string; operation: string }
    >();

    for (const s of samples.filter((x) => x.snapshot.isSlow)) {
      const { queryHash, query, durationMs, table, operation } = s.snapshot;
      if (!map.has(queryHash)) {
        map.set(queryHash, { query, durations: [], table, operation });
      }
      map.get(queryHash)!.durations.push(durationMs);
    }

    return Array.from(map.entries())
      .map(([hash, data]) => {
        const avg =
          Math.round(
            (data.durations.reduce((a, b) => a + b, 0) / data.durations.length) * 100,
          ) / 100;
        const max = Math.max(...data.durations);
        return {
          queryHash: hash,
          query: data.query,
          avgDurationMs: avg,
          maxDurationMs: max,
          count: data.durations.length,
          table: data.table,
          operation: data.operation,
          recommendation: this.recommend(data.operation, data.table, avg),
        };
      })
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs);
  }

  private recommend(operation: string, table?: string, avgMs?: number): string {
    if (operation === 'SELECT') {
      if (avgMs && avgMs > 1000)
        return `Consider adding a composite index on ${table ?? 'this table'} or caching results`;
      return `Review index coverage on ${table ?? 'this table'}; use EXPLAIN ANALYSE`;
    }
    if (operation === 'UPDATE' || operation === 'DELETE') {
      return `Ensure WHERE clause on ${table ?? 'this table'} uses an indexed column`;
    }
    return 'Review query plan using EXPLAIN ANALYSE';
  }

  computeStats(samples: QuerySample[]): {
    total: number;
    slowCount: number;
    avgMs: number;
    p95Ms: number;
    p99Ms: number;
  } {
    if (!samples.length)
      return { total: 0, slowCount: 0, avgMs: 0, p95Ms: 0, p99Ms: 0 };

    const durations = samples.map((s) => s.snapshot.durationMs).sort((a, b) => a - b);
    const slowCount = samples.filter((s) => s.snapshot.isSlow).length;

    return {
      total: samples.length,
      slowCount,
      avgMs:
        Math.round(
          (durations.reduce((a, b) => a + b, 0) / durations.length) * 100,
        ) / 100,
      p95Ms: durations[Math.floor(durations.length * 0.95)] ?? durations[durations.length - 1],
      p99Ms: durations[Math.floor(durations.length * 0.99)] ?? durations[durations.length - 1],
    };
  }
}
