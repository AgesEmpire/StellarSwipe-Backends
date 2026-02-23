import { Controller, Get, Post, Delete, Query } from '@nestjs/common';
import { CacheMetricsService } from './monitoring/cache-metrics.service';
import { CacheInvalidatorService, InvalidationEvent } from './invalidation/cache-invalidator.service';

@Controller('cache')
export class CacheController {
  constructor(
    private metricsService: CacheMetricsService,
    private invalidatorService: CacheInvalidatorService,
  ) {}

  @Get('stats')
  getStats(): unknown {
    return this.metricsService.getStats();
  }

  @Get('report')
  getReport(): unknown {
    return {
      report: this.metricsService.getPerformanceReport(),
      stats: this.metricsService.getStats(),
    };
  }

  @Get('health')
  checkHealth() {
    const isHealthy = this.metricsService.checkHitRateThreshold(80);
    const stats = this.metricsService.getStats();

    return {
      healthy: isHealthy,
      hitRate: stats.overall.hitRate,
      threshold: 80,
      message: isHealthy
        ? 'Cache performance is optimal'
        : 'Cache hit rate below threshold',
    };
  }

  @Post('invalidate')
  async invalidate(@Query('event') event: string, @Query('data') data: string) {
    const eventType = event as InvalidationEvent;
    const eventData = data ? JSON.parse(data) : {};
    
    await this.invalidatorService.invalidateOnEvent(eventType, eventData);
    
    return { message: 'Cache invalidated successfully' };
  }

  @Delete('clear')
  async clearAll() {
    await this.invalidatorService.invalidateAll();
    return { message: 'All caches cleared' };
  }

  @Post('reset-stats')
  resetStats() {
    this.metricsService.resetStats();
    return { message: 'Cache statistics reset' };
  }
}
