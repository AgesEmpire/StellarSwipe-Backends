import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Trade, TradeStatus } from '../../trades/entities/trade.entity';
import { Signal, SignalStatus } from '../../signals/entities/signal.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Real-Time Data Aggregator
 * Aggregates real-time metrics from various data sources
 */
@Injectable()
export class RealTimeAggregator {
  constructor(
    @InjectRepository(Trade)
    private tradeRepository: Repository<Trade>,
    @InjectRepository(Signal)
    private signalRepository: Repository<Signal>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * Get active users count
   */
  async getActiveUsersCount(timeframeMinutes: number = 30): Promise<number> {
    const cacheKey = `active_users_${timeframeMinutes}`;
    const cached = await this.cacheManager.get<number>(cacheKey);
    
    if (cached !== undefined) {
      return cached;
    }

    const timeThreshold = new Date(Date.now() - timeframeMinutes * 60 * 1000);
    const count = await this.userRepository.count({
      where: {
        lastLoginAt: MoreThanOrEqual(timeThreshold),
        isActive: true,
      },
    });

    await this.cacheManager.set(cacheKey, count, 60000); // 1 minute cache
    return count;
  }

  /**
   * Get total active signals
   */
  async getActiveSignalsCount(): Promise<number> {
    const cacheKey = 'active_signals_count';
    const cached = await this.cacheManager.get<number>(cacheKey);
    
    if (cached !== undefined) {
      return cached;
    }

    const count = await this.signalRepository.count({
      where: { status: SignalStatus.ACTIVE },
    });

    await this.cacheManager.set(cacheKey, count, 120000); // 2 minutes cache
    return count;
  }

  /**
   * Get recent trades volume
   */
  async getRecentTradesVolume(hoursBack: number = 24): Promise<number> {
    const cacheKey = `trades_volume_${hoursBack}h`;
    const cached = await this.cacheManager.get<number>(cacheKey);
    
    if (cached !== undefined) {
      return cached;
    }

    const timeThreshold = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const trades = await this.tradeRepository.find({
      where: {
        status: TradeStatus.COMPLETED,
        closedAt: MoreThanOrEqual(timeThreshold),
      },
    });

    const volume = trades.reduce((sum, trade) => sum + Number(trade.totalValue || 0), 0);
    await this.cacheManager.set(cacheKey, volume, 300000); // 5 minutes cache
    return volume;
  }

  /**
   * Get total revenue (sum of fees)
   */
  async getTotalRevenue(hoursBack: number = 24): Promise<number> {
    const cacheKey = `total_revenue_${hoursBack}h`;
    const cached = await this.cacheManager.get<number>(cacheKey);
    
    if (cached !== undefined) {
      return cached;
    }

    const timeThreshold = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const trades = await this.tradeRepository.find({
      where: {
        status: TradeStatus.COMPLETED,
        closedAt: MoreThanOrEqual(timeThreshold),
      },
    });

    const revenue = trades.reduce((sum, trade) => sum + Number(trade.feeAmount || 0), 0);
    await this.cacheManager.set(cacheKey, revenue, 300000); // 5 minutes cache
    return revenue;
  }

  /**
   * Get top performing signals
   */
  async getTopSignals(limit: number = 10): Promise<Signal[]> {
    const cacheKey = `top_signals_${limit}`;
    const cached = await this.cacheManager.get<Signal[]>(cacheKey);
    
    if (cached !== undefined) {
      return cached;
    }

    const signals = await this.signalRepository.find({
      where: { status: SignalStatus.ACTIVE },
      relations: ['provider'],
      order: { createdAt: 'DESC' },
      take: limit,
    });

    await this.cacheManager.set(cacheKey, signals, 600000); // 10 minutes cache
    return signals;
  }

  /**
   * Get trade statistics
   */
  async getTradeStats(hoursBack: number = 24): Promise<{
    totalTrades: number;
    successfulTrades: number;
    failedTrades: number;
    successRate: number;
    averageTradeSize: number;
  }> {
    const cacheKey = `trade_stats_${hoursBack}h`;
    const cached = await this.cacheManager.get(cacheKey);
    
    if (cached !== undefined) {
      return cached as any;
    }

    const timeThreshold = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    
    const totalTrades = await this.tradeRepository.count({
      where: {
        createdAt: MoreThanOrEqual(timeThreshold),
      },
    });

    const successfulTrades = await this.tradeRepository.count({
      where: {
        status: TradeStatus.COMPLETED,
        createdAt: MoreThanOrEqual(timeThreshold),
      },
    });

    const failedTrades = await this.tradeRepository.count({
      where: {
        status: TradeStatus.FAILED,
        createdAt: MoreThanOrEqual(timeThreshold),
      },
    });

    const trades = await this.tradeRepository.find({
      where: {
        status: TradeStatus.COMPLETED,
        createdAt: MoreThanOrEqual(timeThreshold),
      },
    });

    const totalVolume = trades.reduce((sum, trade) => sum + Number(trade.totalValue || 0), 0);
    const averageTradeSize = trades.length > 0 ? totalVolume / trades.length : 0;
    const successRate = totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0;

    const stats = {
      totalTrades,
      successfulTrades,
      failedTrades,
      successRate,
      averageTradeSize,
    };

    await this.cacheManager.set(cacheKey, stats, 300000); // 5 minutes cache
    return stats;
  }

  /**
   * Get new users count
   */
  async getNewUsersCount(hoursBack: number = 24): Promise<number> {
    const cacheKey = `new_users_${hoursBack}h`;
    const cached = await this.cacheManager.get<number>(cacheKey);
    
    if (cached !== undefined) {
      return cached;
    }

    const timeThreshold = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const count = await this.userRepository.count({
      where: {
        createdAt: MoreThanOrEqual(timeThreshold),
      },
    });

    await this.cacheManager.set(cacheKey, count, 600000); // 10 minutes cache
    return count;
  }

  /**
   * Clear all cached metrics
   */
  async clearAllCache(): Promise<void> {
    const keys = [
      'active_users_30',
      'active_signals_count',
      'trades_volume_24h',
      'total_revenue_24h',
      'top_signals_10',
      'trade_stats_24h',
      'new_users_24h',
    ];

    await Promise.all(keys.map(key => this.cacheManager.del(key)));
  }
}
