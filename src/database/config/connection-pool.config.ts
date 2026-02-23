import { registerAs } from '@nestjs/config';
import { PoolOptions } from 'pg';

/**
 * Database Connection Pool Configuration
 *
 * Optimized for 10k+ user base with:
 * - Minimum 10 connections to handle baseline load
 * - Maximum 30 connections to prevent resource exhaustion
 * - Connection timeout handling
 * - Idle connection management
 */
export const connectionPoolConfig = registerAs(
  'connectionPool',
  (): PoolOptions => ({
    // Connection pool limits
    min: parseInt(process.env.DATABASE_POOL_MIN || '10', 10),
    max: parseInt(process.env.DATABASE_POOL_MAX || '30', 10),

    // Connection acquisition timeout (ms)
    idleTimeoutMillis: parseInt(
      process.env.DATABASE_POOL_IDLE_TIMEOUT || '30000',
      10,
    ),

    // Maximum connection lifetime (ms) - 1 hour
    connectionTimeoutMillis: parseInt(
      process.env.DATABASE_POOL_CONNECTION_TIMEOUT || '2000',
      10,
    ),

    // Maximum number of rows to return in a query result
    // Helps prevent OOM from large result sets
    max_rows: parseInt(process.env.DATABASE_POOL_MAX_ROWS || '10000', 10),

    // Enable PTIME (statement execution time) logging
    // Log queries that take longer than 100ms
    statement_timeout: parseInt(
      process.env.DATABASE_STATEMENT_TIMEOUT || '100000',
      10,
    ), // 100 seconds max

    // Enable query cancellation on socket timeout
    query_timeout: parseInt(process.env.DATABASE_QUERY_TIMEOUT || '10000', 10), // 10 seconds
  }),
);

/**
 * Query Performance Thresholds
 */
export const queryPerformanceConfig = registerAs('queryPerformance', () => ({
  // Slow query threshold in milliseconds
  slowQueryThreshold: parseInt(
    process.env.SLOW_QUERY_THRESHOLD_MS || '100',
    10,
  ),

  // Enable query logging
  enableQueryLogging: process.env.ENABLE_QUERY_LOGGING === 'true',

  // Log EXPLAIN ANALYZE for queries exceeding threshold
  logExplainAnalyze: process.env.LOG_EXPLAIN_ANALYZE === 'true',

  // Maximum queries to keep in recent logs
  maxLoggedQueries: parseInt(process.env.MAX_LOGGED_QUERIES || '1000', 10),

  // Cache configuration
  cache: {
    // Enable query result caching
    enabled: process.env.QUERY_CACHE_ENABLED !== 'false',

    // Default TTL for cached query results (seconds)
    defaultTtl: parseInt(process.env.QUERY_CACHE_TTL || '60', 10),

    // Maximum cached entries
    maxEntries: parseInt(process.env.QUERY_CACHE_MAX_ENTRIES || '1000', 10),
  },
}));

/**
 * Index Management Configuration
 */
export const indexManagementConfig = registerAs('indexManagement', () => ({
  // Auto-analyze tables for query optimization
  autoAnalyze: process.env.AUTO_ANALYZE !== 'false',

  // Auto-vacuum configuration
  autoVacuum: process.env.AUTO_VACUUM !== 'false',

  // Analyze threshold - percentage of rows changed before auto-analyze
  analyzeThreshold: parseInt(process.env.ANALYZE_THRESHOLD || '10', 10),

  // Vacuum threshold - percentage of rows deleted before auto-vacuum
  vacuumThreshold: parseInt(process.env.VACUUM_THRESHOLD || '20', 10),

  // Index creation recommendations
  recommendIndexes: process.env.RECOMMEND_INDEXES !== 'false',
}));
