import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Index definition for database optimization
 */
export interface IndexDefinition {
  name: string;
  tableName: string;
  columns: { name: string; order?: 'ASC' | 'DESC' }[];
  isUnique?: boolean;
  isPartial?: boolean;
  partialCondition?: string;
  isConcurrently?: boolean;
}

/**
 * Index management result
 */
export interface IndexManagementResult {
  success: boolean;
  indexName: string;
  message: string;
  executionTime?: number;
}

/**
 * Index Analysis Result
 */
export interface IndexAnalysisResult {
  tableName: string;
  missingIndexes: IndexDefinition[];
  unusedIndexes: { indexName: string; size: string }[];
  duplicateIndexes: string[];
  recommendations: string[];
}

/**
 * Index Manager Service
 *
 * Manages database indexes for optimal query performance.
 * Handles creation, analysis, and maintenance of indexes.
 */
@Injectable()
export class IndexManagerService implements OnModuleInit {
  private readonly logger = new Logger(IndexManagerService.name);

  // Required indexes for the application
  private readonly requiredIndexes: IndexDefinition[] = [
    // Signals indexes
    {
      name: 'idx_signals_feed',
      tableName: 'signals',
      columns: [{ name: 'status' }, { name: 'created_at', order: 'DESC' }],
    },
    {
      name: 'idx_signals_provider',
      tableName: 'signals',
      columns: [{ name: 'provider_id' }, { name: 'created_at', order: 'DESC' }],
    },
    {
      name: 'idx_trades_user_status',
      tableName: 'trades',
      columns: [{ name: 'user_id' }, { name: 'status' }],
    },
    {
      name: 'idx_performance_provider_date',
      tableName: 'signal_performance',
      columns: [{ name: 'provider_id' }, { name: 'date' }],
    },
    // Provider stats index
    {
      name: 'idx_provider_stats_provider',
      tableName: 'provider_stats',
      columns: [{ name: 'provider_id' }],
    },
    // Additional composite indexes for common queries
    {
      name: 'idx_signals_status_type',
      tableName: 'signals',
      columns: [{ name: 'status' }, { name: 'type' }],
    },
    {
      name: 'idx_trades_user_created',
      tableName: 'trades',
      columns: [{ name: 'user_id' }, { name: 'created_at', order: 'DESC' }],
    },
  ];

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    this.logger.log('Index Manager Service initialized');
  }

  /**
   * Create all required indexes
   */
  async createAllIndexes(): Promise<IndexManagementResult[]> {
    const results: IndexManagementResult[] = [];

    for (const indexDef of this.requiredIndexes) {
      const result = await this.createIndex(indexDef);
      results.push(result);
    }

    return results;
  }

  /**
   * Create a specific index
   */
  async createIndex(indexDef: IndexDefinition): Promise<IndexManagementResult> {
    const startTime = Date.now();

    try {
      // Check if index already exists
      const exists = await this.indexExists(indexDef.name);
      if (exists) {
        return {
          success: true,
          indexName: indexDef.name,
          message: 'Index already exists',
        };
      }

      // Build the CREATE INDEX statement
      let sql = `CREATE INDEX`;

      if (indexDef.isConcurrently) {
        sql += ' CONCURRENTLY';
      }

      if (indexDef.isUnique) {
        sql += ' UNIQUE';
      }

      sql += ` ${indexDef.name} ON ${indexDef.tableName}`;

      if (indexDef.isPartial && indexDef.partialCondition) {
        sql += ` WHERE ${indexDef.partialCondition}`;
      }

      sql += ` (${indexDef.columns.map((c) => `${c.name} ${c.order || 'ASC'}`).join(', ')})`;

      await this.dataSource.query(sql);

      const executionTime = Date.now() - startTime;

      this.logger.log(`Created index ${indexDef.name} in ${executionTime}ms`);

      return {
        success: true,
        indexName: indexDef.name,
        message: 'Index created successfully',
        executionTime,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create index ${indexDef.name}: ${error.message}`,
      );

      return {
        success: false,
        indexName: indexDef.name,
        message: `Failed to create index: ${error.message}`,
      };
    }
  }

  /**
   * Drop an index
   */
  async dropIndex(
    indexName: string,
    ifExists = true,
  ): Promise<IndexManagementResult> {
    try {
      const exists = await this.indexExists(indexName);

      if (!exists && ifExists) {
        return {
          success: true,
          indexName,
          message: 'Index does not exist, skipping',
        };
      }

      await this.dataSource.query(
        `DROP INDEX ${ifExists ? 'IF EXISTS ' : ''}${indexName}`,
      );

      this.logger.log(`Dropped index ${indexName}`);

      return {
        success: true,
        indexName,
        message: 'Index dropped successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to drop index ${indexName}: ${error.message}`);

      return {
        success: false,
        indexName,
        message: `Failed to drop index: ${error.message}`,
      };
    }
  }

  /**
   * Check if an index exists
   */
  async indexExists(indexName: string): Promise<boolean> {
    const result = await this.dataSource.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = $1`,
      [indexName],
    );

    return result.length > 0;
  }

  /**
   * Get all indexes for a table
   */
  async getTableIndexes(tableName: string): Promise<any[]> {
    return await this.dataSource.query(
      `SELECT 
        indexname, 
        indexdef 
       FROM pg_indexes 
       WHERE tablename = $1`,
      [tableName],
    );
  }

  /**
   * Analyze indexes and provide recommendations
   */
  async analyzeIndexes(): Promise<IndexAnalysisResult> {
    const result: IndexAnalysisResult = {
      tableName: '',
      missingIndexes: [],
      unusedIndexes: [],
      duplicateIndexes: [],
      recommendations: [],
    };

    // Get all indexes
    const allIndexes = await this.dataSource.query(`
      SELECT 
        schemaname,
        tablename,
        indexname,
        idx_scan,
        idx_tup_read,
        idx_tup_fetch,
        pg_size_pretty(pg_relation_size(indexrelid)) as size
      FROM pg_stat_user_indexes
      ORDER BY pg_relation_size(indexrelid) DESC
    `);

    // Find unused indexes (never scanned)
    for (const idx of allIndexes) {
      if (idx.idx_scan === 0) {
        result.unusedIndexes.push({
          indexName: idx.indexname,
          size: idx.size,
        });

        result.recommendations.push(
          `Consider dropping unused index: ${idx.indexname} (size: ${idx.size})`,
        );
      }
    }

    // Check for missing required indexes
    for (const required of this.requiredIndexes) {
      const exists = await this.indexExists(required.name);
      if (!exists) {
        result.missingIndexes.push(required);
        result.recommendations.push(
          `Missing required index: ${required.name} on ${required.tableName}`,
        );
      }
    }

    // Find duplicate indexes
    const indexColumns = new Map<string, string[]>();

    for (const idx of allIndexes) {
      const def = idx.indexdef.replace(/.*\((.*)\).*/g, '$1');
      const existing = indexColumns.get(def) || [];
      existing.push(idx.indexname);
      indexColumns.set(def, existing);
    }

    for (const [columns, names] of indexColumns.entries()) {
      if (names.length > 1) {
        result.duplicateIndexes.push(...names.slice(1));
        result.recommendations.push(
          `Duplicate indexes found: ${names.join(', ')}`,
        );
      }
    }

    return result;
  }

  /**
   * Rebuild/reindex an index
   */
  async reindexIndex(
    indexName: string,
    concurrently = true,
  ): Promise<IndexManagementResult> {
    try {
      const startTime = Date.now();

      await this.dataSource.query(
        `REINDEX INDEX ${concurrently ? 'CONCURRENTLY ' : ''}${indexName}`,
      );

      const executionTime = Date.now() - startTime;

      this.logger.log(`Reindexed index ${indexName} in ${executionTime}ms`);

      return {
        success: true,
        indexName,
        message: 'Index reindexed successfully',
        executionTime,
      };
    } catch (error) {
      this.logger.error(`Failed to reindex ${indexName}: ${error.message}`);

      return {
        success: false,
        indexName,
        message: `Failed to reindex: ${error.message}`,
      };
    }
  }

  /**
   * Get index usage statistics
   */
  async getIndexStats(): Promise<any[]> {
    return await this.dataSource.query(`
      SELECT 
        schemaname,
        tablename,
        indexname,
        idx_scan as scans,
        idx_tup_read as tuples_read,
        idx_tup_fetch as tuples_fetched,
        pg_size_pretty(pg_relation_size(indexrelid)) as size
      FROM pg_stat_user_indexes
      WHERE idx_scan > 0
      ORDER BY idx_scan DESC
      LIMIT 20
    `);
  }

  /**
   * Get table size information
   */
  async getTableStats(): Promise<any[]> {
    return await this.dataSource.query(`
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
        pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
        pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) as indexes_size,
        n_live_tup as row_count
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
      LIMIT 20
    `);
  }

  /**
   * Get the list of required indexes
   */
  getRequiredIndexes(): IndexDefinition[] {
    return this.requiredIndexes;
  }
}
