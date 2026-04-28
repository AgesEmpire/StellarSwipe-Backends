import { Injectable, Logger } from '@nestjs/common';

export interface ErrorMetric {
  service: string;
  endpoint: string;
  statusCode: number;
  errorType: string;
  timestamp: Date;
  count: number;
  lastOccurrence: Date;
}

export interface ServiceErrorStats {
  service: string;
  totalErrors: number;
  errorsByStatus: Map<number, number>;
  errorsByType: Map<string, number>;
  errorsByEndpoint: Map<string, number>;
  errorRate: number;
  averageErrorsPerMinute: number;
}

@Injectable()
export class ErrorMetricsService {
  private readonly logger = new Logger(ErrorMetricsService.name);
  private metrics: Map<string, ErrorMetric> = new Map();
  private startTime: Date = new Date();
  private totalRequests: number = 0;
  private totalErrors: number = 0;

  /**
   * Record an error metric
   */
  recordError(
    service: string,
    endpoint: string,
    statusCode: number,
    errorType: string,
  ): void {
    const key = `${service}:${endpoint}:${statusCode}:${errorType}`;
    const now = new Date();

    const existing = this.metrics.get(key);
    if (existing) {
      existing.count++;
      existing.lastOccurrence = now;
    } else {
      this.metrics.set(key, {
        service,
        endpoint,
        statusCode,
        errorType,
        timestamp: now,
        count: 1,
        lastOccurrence: now,
      });
    }

    this.totalErrors++;

    this.logger.debug(
      `Error recorded: ${service} - ${endpoint} (${statusCode}) - ${errorType}`,
    );
  }

  /**
   * Record a successful request
   */
  recordRequest(): void {
    this.totalRequests++;
  }

  /**
   * Get error statistics for a specific service
   */
  getServiceStats(service: string): ServiceErrorStats {
    const serviceMetrics = Array.from(this.metrics.values()).filter(
      (m) => m.service === service,
    );

    const errorsByStatus = new Map<number, number>();
    const errorsByType = new Map<string, number>();
    const errorsByEndpoint = new Map<string, number>();
    let totalServiceErrors = 0;

    serviceMetrics.forEach((metric) => {
      totalServiceErrors += metric.count;

      // Aggregate by status code
      const currentStatus = errorsByStatus.get(metric.statusCode) || 0;
      errorsByStatus.set(metric.statusCode, currentStatus + metric.count);

      // Aggregate by error type
      const currentType = errorsByType.get(metric.errorType) || 0;
      errorsByType.set(metric.errorType, currentType + metric.count);

      // Aggregate by endpoint
      const currentEndpoint = errorsByEndpoint.get(metric.endpoint) || 0;
      errorsByEndpoint.set(metric.endpoint, currentEndpoint + metric.count);
    });

    const uptime = this.getUptimeInMinutes();
    const errorRate =
      this.totalRequests > 0 ? (this.totalErrors / this.totalRequests) * 100 : 0;
    const averageErrorsPerMinute =
      uptime > 0 ? totalServiceErrors / uptime : 0;

    return {
      service,
      totalErrors: totalServiceErrors,
      errorsByStatus,
      errorsByType,
      errorsByEndpoint,
      errorRate,
      averageErrorsPerMinute,
    };
  }

  /**
   * Get error statistics for all services
   */
  getAllServiceStats(): Map<string, ServiceErrorStats> {
    const services = new Set(Array.from(this.metrics.values()).map((m) => m.service));
    const stats = new Map<string, ServiceErrorStats>();

    services.forEach((service) => {
      stats.set(service, this.getServiceStats(service));
    });

    return stats;
  }

  /**
   * Get top errors by service
   */
  getTopErrorsByService(service: string, limit: number = 10): ErrorMetric[] {
    return Array.from(this.metrics.values())
      .filter((m) => m.service === service)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get top errors across all services
   */
  getTopErrorsGlobal(limit: number = 10): ErrorMetric[] {
    return Array.from(this.metrics.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get errors for specific endpoint
   */
  getEndpointErrors(service: string, endpoint: string): ErrorMetric[] {
    return Array.from(this.metrics.values()).filter(
      (m) => m.service === service && m.endpoint === endpoint,
    );
  }

  /**
   * Get error rate for a specific endpoint
   */
  getEndpointErrorRate(service: string, endpoint: string): number {
    const endpointErrors = this
      .getEndpointErrors(service, endpoint)
      .reduce((sum, m) => sum + m.count, 0);

    if (this.totalRequests === 0) return 0;
    return (endpointErrors / this.totalRequests) * 100;
  }

  /**
   * Clear old metrics (older than specified minutes)
   */
  clearOldMetrics(minutesOld: number): number {
    const cutoffTime = new Date(Date.now() - minutesOld * 60 * 1000);
    let removedCount = 0;

    for (const [key, metric] of this.metrics.entries()) {
      if (metric.lastOccurrence < cutoffTime) {
        this.metrics.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.logger.debug(`Cleared ${removedCount} old metrics`);
    }

    return removedCount;
  }

  /**
   * Clear all metrics
   */
  resetMetrics(): void {
    this.metrics.clear();
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.startTime = new Date();
    this.logger.log('All metrics have been reset');
  }

  /**
   * Get overall statistics
   */
  getGlobalStats() {
    const uptime = this.getUptimeInMinutes();
    const errorRate =
      this.totalRequests > 0 ? (this.totalErrors / this.totalRequests) * 100 : 0;

    return {
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      errorRate,
      uptimeMinutes: uptime,
      startTime: this.startTime,
      metricsCount: this.metrics.size,
      averageErrorsPerMinute: uptime > 0 ? this.totalErrors / uptime : 0,
    };
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): ErrorMetric[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Calculate uptime in minutes
   */
  private getUptimeInMinutes(): number {
    const now = new Date();
    return (now.getTime() - this.startTime.getTime()) / (1000 * 60);
  }
}
