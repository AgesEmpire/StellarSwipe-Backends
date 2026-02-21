import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Materialized View Configuration
 */
export interface MaterializedViewConfig {
  name: string;
  query: string;
  refreshInterval?: number; // in milliseconds
}

/**
 * Leaderboard Entry
 */
export interface LeaderboardEntry {
  rank: number;
  providerId: string;
  score: number;
  metric: string;
  period: string;
}

/**
 * Materialized View Service
 *
 * Manages materialized views for optimized leaderboards and analytics.
 * Supports automatic refresh and incremental updates.
 */
@Injectable()
export class MaterializedViewService implements OnModuleInit {
  private readonly logger = new Logger(MaterializedViewService.name);

  // Materialized view configurations
  private readonly viewConfigs: MaterializedViewConfig[] = [
    {
      name: 'mv_provider_leaderboard_pnl',
      query: `
        CREATE MATERIALIZED VIEW mv_provider_leaderboard_pnl AS
        SELECT 
          ps.provider_id,
          ps.total_pnl::numeric as score,
          ROW_NUMBER() OVER (ORDER BY ps.total_pnl DESC) as rank,
          'pnl' as metric,
          NOW()::date as period
        FROM provider_stats ps
        WHERE ps.total_pnl IS NOT NULL
        WITH DATA
      `,
      refreshInterval: 300000, // 5 minutes
    },
    {
      name: 'mv_provider_leaderboard_win_rate',
      query: `
        CREATE MATERIALIZED VIEW mv_provider_leaderboard_win_rate AS
        SELECT 
          ps.provider_id,
          ps.win_rate::numeric as score,
          ROW_NUMBER() OVER (ORDER BY ps.win_rate DESC) as rank,
          'win_rate' as metric,
          NOW()::date as period
        FROM provider_stats ps
        WHERE ps.win_rate IS NOT NULL
        WITH DATA
      `,
      refreshInterval: 300000,
    },
    {
      name: 'mv_provider_leaderboard_volume',
      query: `
        CREATE MATERIALIZED VIEW mv_provider_leaderboard_volume AS
        SELECT 
          ps.provider_id,
          ps.total_volume_copied::numeric as score,
          ROW_NUMBER() OVER (ORDER BY ps.total_volume_copied DESC) as rank,
          'volume' as metric,
          NOW()::date as period
        FROM provider_stats ps
        WHERE ps.total_volume_copied IS NOT NULL
        WITH DATA
      `,
      refreshInterval: 300000,
    },
    {
      name: 'mv_provider_leaderboard_overall',
      query: `
        CREATE MATERIALIZED VIEW mv_provider_leaderboard_overall AS
        SELECT 
          ps.provider_id,
          (
            COALESCE(ps.win_rate::numeric, 0) * 0.3 +
            COALESCE(ps.total_pnl::numeric, 0) / 1000000 * 0.3 +
            COALESCE(ps.total_volume_copied::numeric, 0) / 1000000 * 0.2 +
            COALESCE(ps.reputation_score::numeric, 50) * 0.2
          ) as score,
          ROW_NUMBER() OVER (
            ORDER BY 
              COALESCE(ps.win_rate::numeric, 0) * 0.3 +
              COALESCE(ps.total_pnl::numeric, 0) / 1000000 * 0.3 +
              COALESCE(ps.total_volume_copied::numeric, 0) / 1000000 * 0.2 +
              COALESCE(ps.reputation_score::numeric, 50) * 0.2 DESC
          ) as rank,
          'overall' as metric,
          NOW()::date as period
        FROM provider_stats ps
        WITH DATA
      `,
      refreshInterval: 300000,
    },
  ];

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    this.logger.log('Materialized View Service initialized');
  }

  /**
   * Initialize all materialized views
   */
  async initializeViews(): Promise<void> {
    for (const config of this.viewConfigs) {
      await this.createMaterializedViewIfNotExists(config);
    }
    this.logger.log('All materialized views initialized');
  }

  /**
   * Create a materialized view if it doesn't exist
   */
  async createMaterializedViewIfNotExists(
    config: MaterializedViewConfig,
  ): Promise<void> {
    try {
      const exists = await this.viewExists(config.name);

      if (!exists) {
        await this.dataSource.query(config.query);
        this.logger.log(`Created materialized view: ${config.name}`);

        // Create index on the materialized view
        await this.createViewIndex(config.name);
      } else {
        this.logger.debug(`Materialized view already exists: ${config.name}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to create materialized view ${config.name}: ${error.message}`,
      );
    }
  }

  /**
   * Check if a materialized view exists
   */
  async viewExists(viewName: string): Promise<boolean> {
    const result = await this.dataSource.query(
      `SELECT 1 FROM pg_matviews WHERE matviewname = $1`,
      [viewName],
    );
    return result.length > 0;
  }

  /**
   * Create index on materialized view
   */
  async createViewIndex(viewName: string): Promise<void> {
    try {
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_${viewName}_provider ON ${viewName}(provider_id)`,
      );
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_${viewName}_rank ON ${viewName}(rank)`,
      );
      this.logger.debug(`Created indexes for materialized view: ${viewName}`);
    } catch (error) {
      this.logger.error(
        `Failed to create index for ${viewName}: ${error.message}`,
      );
    }
  }

  /**
   * Refresh a materialized view
   */
  async refreshMaterializedView(
    viewName: string,
    concurrently = true,
  ): Promise<void> {
    try {
      const startTime = Date.now();

      if (concurrently) {
        await this.dataSource.query(
          `REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`,
        );
      } else {
        await this.dataSource.query(`REFRESH MATERIALIZED VIEW ${viewName}`);
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Refreshed materialized view ${viewName} in ${duration}ms`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to refresh materialized view ${viewName}: ${error.message}`,
      );
    }
  }

  /**
   * Refresh all materialized views
   */
  async refreshAllViews(): Promise<void> {
    for (const config of this.viewConfigs) {
      await this.refreshMaterializedView(config.name);
    }
  }

  /**
   * Get leaderboard entries
   */
  async getLeaderboard(
    metric: 'pnl' | 'win_rate' | 'volume' | 'overall',
    limit = 100,
    offset = 0,
  ): Promise<LeaderboardEntry[]> {
    const viewMap: Record<string, string> = {
      pnl: 'mv_provider_leaderboard_pnl',
      win_rate: 'mv_provider_leaderboard_win_rate',
      volume: 'mv_provider_leaderboard_volume',
      overall: 'mv_provider_leaderboard_overall',
    };

    const viewName = viewMap[metric];

    try {
      const result = await this.dataSource.query(
        `SELECT rank, provider_id, score, metric, period 
         FROM ${viewName} 
         ORDER BY rank 
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );

      return result.map((row: any) => ({
        rank: parseInt(row.rank),
        providerId: row.provider_id,
        score: parseFloat(row.score),
        metric: row.metric,
        period: row.period,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to get leaderboard for ${metric}: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Get provider rank from leaderboard
   */
  async getProviderRank(
    providerId: string,
    metric: 'pnl' | 'win_rate' | 'volume' | 'overall',
  ): Promise<number | null> {
    const viewMap: Record<string, string> = {
      pnl: 'mv_provider_leaderboard_pnl',
      win_rate: 'mv_provider_leaderboard_win_rate',
      volume: 'mv_provider_leaderboard_volume',
      overall: 'mv_provider_leaderboard_overall',
    };

    const viewName = viewMap[metric];

    try {
      const result = await this.dataSource.query(
        `SELECT rank FROM ${viewName} WHERE provider_id = $1`,
        [providerId],
      );

      return result.length > 0 ? parseInt(result[0].rank) : null;
    } catch (error) {
      this.logger.error(`Failed to get provider rank: ${error.message}`);
      return null;
    }
  }

  /**
   * Drop a materialized view
   */
  async dropMaterializedView(viewName: string): Promise<void> {
    try {
      await this.dataSource.query(
        `DROP MATERIALIZED VIEW IF EXISTS ${viewName}`,
      );
      this.logger.log(`Dropped materialized view: ${viewName}`);
    } catch (error) {
      this.logger.error(
        `Failed to drop materialized view ${viewName}: ${error.message}`,
      );
    }
  }

  /**
   * Get materialized view statistics
   */
  async getViewStats(): Promise<any[]> {
    return await this.dataSource.query(`
      SELECT 
        schemaname,
        matviewname,
        matviewowner,
        tablespace,
        has_indexes,
        is_populated,
        pg_size_pretty(pg_relation_size(schemaname||'.'||matviewname)) as size
      FROM pg_matviews
      ORDER BY pg_relation_size(schemaname||'.'||matviewname) DESC
    `);
  }
}
