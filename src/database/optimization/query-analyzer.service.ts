import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, QueryRunner, QueryExecutor, Log } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Query Performance Analysis Result
 */
export interface QueryPerformanceResult {
  query: string;
  parameters: any[];
  executionTimeMs: number;
  timestamp: Date;
  isSlow: boolean;
  explainAnalyze?: string;
}

/**
 * Query Analysis Statistics
 */
export interface QueryAnalysisStats {
  totalQueries: number;
  slowQueries: number;
  averageExecutionTime: number;
  p95ExecutionTime: number;
  p99ExecutionTime: number;
  mostFrequentQueries: { query: string; count: number; avgTime: number }[];
}

/**
 * Query Analyzer Service
 *
 * Monitors and analyzes database query performance to identify bottlenecks.
 * Enables query logging for slow queries (>100ms) and provides insights
 * for optimization.
 */
@Injectable()
export class QueryAnalyzerService implements OnModuleInit {
  private readonly logger = new Logger(QueryAnalyzerService.name);

  // Configuration
  private readonly slowQueryThresholdMs: number;
  private readonly enableQueryLogging: boolean;
  private readonly logExplainAnalyze: boolean;
  private readonly maxLoggedQueries: number;

  // Query performance tracking
  private readonly queryLog: QueryPerformanceResult[] = [];
  private readonly queryFrequency: Map<
    string,
    { count: number; totalTime: number }
  > = new Map();

  // Statistics
  private totalQueries = 0;
  private totalExecutionTime = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {
    // Load configuration from environment
    this.slowQueryThresholdMs = parseInt(
      process.env.SLOW_QUERY_THRESHOLD_MS || '100',
      10,
    );
    this.enableQueryLogging = process.env.ENABLE_QUERY_LOGGING === 'true';
    this.logExplainAnalyze = process.env.LOG_EXPLAIN_ANALYZE === 'true';
    this.maxLoggedQueries = parseInt(
      process.env.MAX_LOGGED_QUERIES || '1000',
      10,
    );
  }

  async onModuleInit() {
    this.logger.log('Query Analyzer Service initialized');
    this.logger.log(`Slow query threshold: ${this.slowQueryThresholdMs}ms`);

    if (this.enableQueryLogging) {
      this.logger.log('Query logging is enabled');
    }

    if (this.logExplainAnalyze) {
      this.logger.log('EXPLAIN ANALYZE logging is enabled for slow queries');
    }
  }

  /**
   * Analyze a query and record its performance
   */
  async analyzeQuery(
    query: string,
    parameters: any[] = [],
    executionFn: () => Promise<any>,
  ): Promise<any> {
    const startTime = performance.now();

    try {
      const result = await executionFn();
      const executionTime = performance.now() - startTime;

      this.recordQueryPerformance(query, parameters, executionTime, null);

      return result;
    } catch (error) {
      const executionTime = performance.now() - startTime;
      this.recordQueryPerformance(query, parameters, executionTime, error);
      throw error;
    }
  }

  /**
   * Record query performance metrics
   */
  private recordQueryPerformance(
    query: string,
    parameters: any[],
    executionTimeMs: number,
    error: Error | null,
  ): void {
    const normalizedQuery = this.normalizeQuery(query);
    const isSlow = executionTimeMs > this.slowQueryThresholdMs;

    // Update frequency map
    const freqEntry = this.queryFrequency.get(normalizedQuery) || {
      count: 0,
      totalTime: 0,
    };
    freqEntry.count++;
    freqEntry.totalTime += executionTimeMs;
    this.queryFrequency.set(normalizedQuery, freqEntry);

    // Update global stats
    this.totalQueries++;
    this.totalExecutionTime += executionTimeMs;

    // Record slow queries
    if (isSlow || this.enableQueryLogging) {
      const performanceResult: QueryPerformanceResult = {
        query: query.substring(0, 500), // Truncate long queries for logging
        parameters: this.sanitizeParameters(parameters),
        executionTimeMs,
        timestamp: new Date(),
        isSlow,
      };

      // Add to log
      this.queryLog.push(performanceResult);

      // Trim log if exceeds max
      if (this.queryLog.length > this.maxLoggedQueries) {
        this.queryLog.shift();
      }

      // Log slow queries
      if (isSlow) {
        this.logger.warn(
          `Slow query detected (${executionTimeMs.toFixed(2)}ms): ${normalizedQuery.substring(0, 100)}`,
        );

        // Emit event for monitoring
        this.eventEmitter.emit('query.slow', performanceResult);
      }
    }
  }

  /**
   * Get EXPLAIN ANALYZE results for a query
   */
  async getExplainAnalyze(
    query: string,
    parameters: any[] = [],
  ): Promise<string> {
    try {
      const explainQuery = `EXPLAIN ANALYZE ${query}`;
      const result = await this.dataSource.query(explainQuery, parameters);

      if (Array.isArray(result)) {
        return result
          .map((row: any) => Object.values(row).join(' '))
          .join('\n');
      }

      return JSON.stringify(result);
    } catch (error) {
      this.logger.error(`Failed to get EXPLAIN ANALYZE: ${error.message}`);
      return '';
    }
  }

  /**
   * Get query performance statistics
   */
  getStatistics(): QueryAnalysisStats {
    const sortedTimes = this.queryLog
      .map((q) => q.executionTimeMs)
      .sort((a, b) => a - b);

    const p95Index = Math.floor(sortedTimes.length * 0.95);
    const p99Index = Math.floor(sortedTimes.length * 0.99);

    // Get most frequent queries
    const mostFrequent = Array.from(this.queryFrequency.entries())
      .map(([query, data]) => ({
        query: query.substring(0, 100),
        count: data.count,
        avgTime: data.totalTime / data.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalQueries: this.totalQueries,
      slowQueries: this.queryLog.filter((q) => q.isSlow).length,
      averageExecutionTime:
        this.totalQueries > 0 ? this.totalExecutionTime / this.totalQueries : 0,
      p95ExecutionTime: sortedTimes[p95Index] || 0,
      p99ExecutionTime: sortedTimes[p99Index] || 0,
      mostFrequentQueries: mostFrequent,
    };
  }

  /**
   * Get recent slow queries
   */
  getSlowQueries(limit = 100): QueryPerformanceResult[] {
    return this.queryLog
      .filter((q) => q.isSlow)
      .sort((a, b) => b.executionTimeMs - a.executionTimeMs)
      .slice(0, limit);
  }

  /**
   * Get recent query log
   */
  getRecentQueries(limit = 100): QueryPerformanceResult[] {
    return this.queryLog.slice(-limit);
  }

  /**
   * Clear query log
   */
  clearLog(): void {
    this.queryLog.length = 0;
    this.queryFrequency.clear();
    this.totalQueries = 0;
    this.totalExecutionTime = 0;
    this.logger.log('Query log cleared');
  }

  /**
   * Normalize query for frequency analysis
   * Removes specific values to group similar queries
   */
  private normalizeQuery(query: string): string {
    // Replace UUIDs, numbers, strings with placeholders
    return query
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        'UUID',
      )
      .replace(/\d+(\.\d+)?/g, 'NUM')
      .replace(/'[^']*'/g, 'STRING')
      .replace(/\$[0-9]+/g, '$N');
  }

  /**
   * Sanitize parameters for logging
   */
  private sanitizeParameters(params: any[]): any[] {
    if (!params || !Array.isArray(params)) return [];

    return params.map((param) => {
      if (typeof param === 'string' && param.length > 100) {
        return param.substring(0, 100) + '...';
      }
      return param;
    });
  }

  /**
   * Check if there are N+1 query patterns
   */
  detectN1Queries(): { suspected: boolean; patterns: string[] } {
    const patterns: string[] = [];
    const queryCounts = new Map<string, number>();

    // Count similar queries
    for (const entry of this.queryLog) {
      const normalized = this.normalizeQuery(entry.query);
      const count = queryCounts.get(normalized) || 0;
      queryCounts.set(normalized, count + 1);
    }

    // Find patterns with high frequency (potential N+1)
    for (const [query, count] of queryCounts.entries()) {
      if (count > 10 && query.includes('SELECT') && !query.includes('JOIN')) {
        patterns.push(
          `Potential N+1: "${query.substring(0, 50)}..." executed ${count} times`,
        );
      }
    }

    return {
      suspected: patterns.length > 0,
      patterns,
    };
  }
}
