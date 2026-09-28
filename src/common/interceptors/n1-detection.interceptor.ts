import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/**
 * Minimal shape of a TypeORM QueryRunner-like object we can hook into.
 * Kept structural so we don't hard-depend on a specific driver version.
 */
interface QueryRunnerLike {
  query: (...args: any[]) => Promise<any>;
}

interface QueryStat {
  count: number;
  totalMs: number;
  maxMs: number;
  slowCount: number;
}

/**
 * Records per-query execution counts and latency, flags slow queries against a
 * configurable threshold, and aggregates latency trends so N+1 patterns and
 * frequent bottlenecks are observable before they reach production.
 */
@Injectable()
export class N1DetectionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(N1DetectionInterceptor.name);

  /** Queries slower than this (ms) are reported as slow. */
  private readonly slowQueryThresholdMs = Number(
    process.env.SLOW_QUERY_THRESHOLD_MS ?? 200,
  );

  /** A request issuing more than this many queries is flagged as a likely N+1. */
  private readonly n1QueryThreshold = Number(
    process.env.N1_QUERY_THRESHOLD ?? 10,
  );

  /** Rolling aggregate across requests, keyed by normalized query text. */
  private readonly stats = new Map<string, QueryStat>();

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const queryRunner: QueryRunnerLike | undefined = request?.queryRunner;

    if (!queryRunner || typeof queryRunner.query !== 'function') {
      return next.handle();
    }

    const originalQuery = queryRunner.query.bind(queryRunner);
    const perRequest = new Map<string, number>();
    let requestQueryCount = 0;

    queryRunner.query = async (...args: any[]) => {
      const sql = typeof args[0] === 'string' ? args[0] : '';
      const key = this.normalize(sql);
      const startedAt = Date.now();

      try {
        return await originalQuery(...args);
      } finally {
        const durationMs = Date.now() - startedAt;
        requestQueryCount += 1;
        perRequest.set(key, (perRequest.get(key) ?? 0) + 1);
        this.record(key, durationMs);

        if (durationMs >= this.slowQueryThresholdMs) {
          this.logger.warn(
            `Slow query (${durationMs}ms >= ${this.slowQueryThresholdMs}ms): ${key}`,
          );
        }
      }
    };

    return next.handle().pipe(
      tap({
        finalize: () => {
          queryRunner.query = originalQuery;
          this.reportRequest(request, requestQueryCount, perRequest);
        },
      }),
    );
  }

  private record(key: string, durationMs: number): void {
    const stat = this.stats.get(key) ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      slowCount: 0,
    };

    stat.count += 1;
    stat.totalMs += durationMs;
    stat.maxMs = Math.max(stat.maxMs, durationMs);
    if (durationMs >= this.slowQueryThresholdMs) {
      stat.slowCount += 1;
    }

    this.stats.set(key, stat);
  }

  private reportRequest(
    request: any,
    requestQueryCount: number,
    perRequest: Map<string, number>,
  ): void {
    const route = request?.route?.path ?? request?.url ?? 'unknown';

    if (requestQueryCount >= this.n1QueryThreshold) {
      const repeated = [...perRequest.entries()]
        .filter(([, count]) => count > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key, count]) => `${count}x ${key}`)
        .join(' | ');

      this.logger.warn(
        `Possible N+1 on ${route}: ${requestQueryCount} queries` +
          (repeated ? ` (repeated: ${repeated})` : ''),
      );
    }

    if (requestQueryCount > 0) {
      this.logger.debug(
        `DB queries for ${route}: ${requestQueryCount} (threshold ${this.n1QueryThreshold})`,
      );
    }
  }

  /**
   * Aggregated latency trends across requests, sorted by total time so the
   * most impactful bottlenecks surface first.
   */
  getReport(): Array<{
    query: string;
    count: number;
    avgMs: number;
    maxMs: number;
    slowCount: number;
  }> {
    return [...this.stats.entries()]
      .map(([query, stat]) => ({
        query,
        count: stat.count,
        avgMs: stat.count ? Math.round(stat.totalMs / stat.count) : 0,
        maxMs: stat.maxMs,
        slowCount: stat.slowCount,
      }))
      .sort((a, b) => b.avgMs * b.count - a.avgMs * a.count);
  }

  /** Collapse whitespace and literals so equivalent queries aggregate together. */
  private normalize(sql: string): string {
    return sql
      .replace(/\s+/g, ' ')
      .replace(/'[^']*'/g, '?')
      .replace(/\b\d+\b/g, '?')
      .trim()
      .slice(0, 200);
  }
}
