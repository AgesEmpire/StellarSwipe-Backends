import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { RealTimeAggregator } from '../aggregators/real-time-aggregator';
import { TrendCalculator } from '../aggregators/trend-calculator';

/**
 * Refresh Executive Metrics Job
 * Periodically refreshes executive dashboard metrics
 */
@Injectable()
export class RefreshExecMetricsJob {
  private readonly logger = new Logger(RefreshExecMetricsJob.name);

  constructor(
    private realTimeAggregator: RealTimeAggregator,
    private trendCalculator: TrendCalculator,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * Run every minute to refresh real-time metrics
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async refreshRealtimeMetrics(): Promise<void> {
    try {
      this.logger.debug('Starting real-time metrics refresh...');

      const [activeUsers, activeSignals, tradesVolume, totalRevenue, tradeStats] =
        await Promise.all([
          this.realTimeAggregator.getActiveUsersCount(30),
          this.realTimeAggregator.getActiveSignalsCount(),
          this.realTimeAggregator.getRecentTradesVolume(24),
          this.realTimeAggregator.getTotalRevenue(24),
          this.realTimeAggregator.getTradeStats(24),
        ]);

      const metrics = {
        activeUsers,
        activeSignals,
        tradesVolume,
        totalRevenue,
        tradeStats,
        timestamp: new Date(),
      };

      await this.cacheManager.set('exec_realtime_metrics', metrics, 120000); // 2 minutes cache
      this.logger.debug('Real-time metrics refreshed successfully');
    } catch (error) {
      this.logger.error('Error refreshing real-time metrics:', error);
    }
  }

  /**
   * Run every 5 minutes to refresh aggregated metrics
   */
  @Cron('*/5 * * * *')
  async refreshAggregatedMetrics(): Promise<void> {
    try {
      this.logger.debug('Starting aggregated metrics refresh...');

      const topSignals = await this.realTimeAggregator.getTopSignals(10);
      const newUsersToday = await this.realTimeAggregator.getNewUsersCount(24);

      const metrics = {
        topSignals,
        newUsersToday,
        timestamp: new Date(),
      };

      await this.cacheManager.set('exec_aggregated_metrics', metrics, 300000); // 5 minutes cache
      this.logger.debug('Aggregated metrics refreshed successfully');
    } catch (error) {
      this.logger.error('Error refreshing aggregated metrics:', error);
    }
  }

  /**
   * Run every hour to calculate trend analysis
   */
  @Cron(CronExpression.EVERY_HOUR)
  async calculateTrendAnalysis(): Promise<void> {
    try {
      this.logger.debug('Starting trend analysis calculation...');

      // Get current and previous hour metrics
      const currentMetrics = await this.realTimeAggregator.getTradeStats(1);
      const previousMetrics = await this.realTimeAggregator.getTradeStats(2);

      const revenueChange = this.trendCalculator.calculatePercentageChange(
        currentMetrics.averageTradeSize,
        previousMetrics.averageTradeSize,
      );

      const successRateChange = this.trendCalculator.calculatePercentageChange(
        currentMetrics.successRate,
        previousMetrics.successRate,
      );

      const trends = {
        revenueChange,
        successRateChange,
        trendDirection: this.trendCalculator.calculateTrendDirection(
          currentMetrics.successRate,
          previousMetrics.successRate,
        ),
        timestamp: new Date(),
      };

      await this.cacheManager.set('exec_trends', trends, 3600000); // 1 hour cache
      this.logger.debug('Trend analysis completed successfully');
    } catch (error) {
      this.logger.error('Error calculating trend analysis:', error);
    }
  }

  /**
   * Run daily at midnight to generate daily summary
   */
  @Cron('0 0 * * *')
  async generateDailySummary(): Promise<void> {
    try {
      this.logger.debug('Starting daily summary generation...');

      const dailyStats = await this.realTimeAggregator.getTradeStats(24);
      const newUsers = await this.realTimeAggregator.getNewUsersCount(24);

      const summary = {
        date: new Date().toISOString().split('T')[0],
        totalTrades: dailyStats.totalTrades,
        successfulTrades: dailyStats.successfulTrades,
        successRate: dailyStats.successRate,
        averageTradeSize: dailyStats.averageTradeSize,
        newUsers,
        timestamp: new Date(),
      };

      // Store in cache with key including date
      const dateKey = new Date().toISOString().split('T')[0];
      await this.cacheManager.set(`exec_daily_summary_${dateKey}`, summary, 86400000); // 24 hours cache
      this.logger.debug('Daily summary generated successfully');
    } catch (error) {
      this.logger.error('Error generating daily summary:', error);
    }
  }

  /**
   * Run every 6 hours to refresh system health metrics
   */
  @Cron('0 */6 * * *')
  async refreshSystemHealth(): Promise<void> {
    try {
      this.logger.debug('Starting system health refresh...');

      // This would integrate with monitoring services
      const healthMetrics = {
        status: 'healthy',
        uptime: 99.9,
        responseTime: 150,
        timestamp: new Date(),
      };

      await this.cacheManager.set('exec_system_health', healthMetrics, 21600000); // 6 hours cache
      this.logger.debug('System health metrics refreshed');
    } catch (error) {
      this.logger.error('Error refreshing system health:', error);
    }
  }

  /**
   * Manual trigger to refresh all metrics
   */
  async refreshAllMetrics(): Promise<void> {
    try {
      this.logger.debug('Manually refreshing all metrics...');
      await this.realTimeAggregator.clearAllCache();

      await Promise.all([
        this.refreshRealtimeMetrics(),
        this.refreshAggregatedMetrics(),
        this.calculateTrendAnalysis(),
        this.refreshSystemHealth(),
      ]);

      this.logger.debug('All metrics refreshed successfully');
    } catch (error) {
      this.logger.error('Error manually refreshing metrics:', error);
      throw error;
    }
  }
}
