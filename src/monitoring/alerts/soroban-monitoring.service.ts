import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';

interface SorobanFailure {
  contractId: string;
  method: string;
  error: string;
  timestamp: Date;
  endpoint?: string;
  userId?: string;
}

interface AlertMetrics {
  failureCount: number;
  failureRate: number;
  affectedEndpoints: string[];
  affectedUsers: number;
  recentErrors: SorobanFailure[];
}

@Injectable()
export class SorobanMonitoringService {
  private readonly logger = new Logger(SorobanMonitoringService.name);
  private readonly failures: SorobanFailure[] = [];
  private readonly alertThreshold: number;
  private readonly timeWindowMs: number;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {
    this.alertThreshold = this.configService.get('SOROBAN_ALERT_THRESHOLD', 5);
    this.timeWindowMs = this.configService.get('SOROBAN_ALERT_WINDOW_MS', 300000); // 5 minutes
  }

  recordFailure(failure: SorobanFailure): void {
    this.failures.push(failure);
    this.logger.warn(`Soroban failure recorded: ${failure.contractId}.${failure.method} - ${failure.error}`);
    
    // Clean old failures outside time window
    this.cleanOldFailures();
    
    // Check if alert threshold is exceeded
    this.checkAlertThreshold();
  }

  private cleanOldFailures(): void {
    const cutoff = new Date(Date.now() - this.timeWindowMs);
    const initialCount = this.failures.length;
    
    for (let i = this.failures.length - 1; i >= 0; i--) {
      if (this.failures[i].timestamp < cutoff) {
        this.failures.splice(i, 1);
      }
    }
    
    if (this.failures.length !== initialCount) {
      this.logger.debug(`Cleaned ${initialCount - this.failures.length} old failures`);
    }
  }

  private checkAlertThreshold(): void {
    const recentFailures = this.getRecentFailures();
    const failureRate = this.calculateFailureRate();
    
    if (recentFailures.length >= this.alertThreshold) {
      const metrics = this.generateAlertMetrics();
      this.triggerAlert(metrics);
    }
  }

  private getRecentFailures(): SorobanFailure[] {
    const cutoff = new Date(Date.now() - this.timeWindowMs);
    return this.failures.filter(f => f.timestamp >= cutoff);
  }

  private calculateFailureRate(): number {
    const recentFailures = this.getRecentFailures();
    const timeWindowMinutes = this.timeWindowMs / 60000;
    return recentFailures.length / timeWindowMinutes;
  }

  private generateAlertMetrics(): AlertMetrics {
    const recentFailures = this.getRecentFailures();
    const affectedEndpoints = [...new Set(recentFailures.map(f => f.endpoint).filter(Boolean))];
    const affectedUsers = new Set(recentFailures.map(f => f.userId).filter(Boolean)).size;
    
    return {
      failureCount: recentFailures.length,
      failureRate: this.calculateFailureRate(),
      affectedEndpoints,
      affectedUsers,
      recentErrors: recentFailures.slice(-10), // Last 10 errors
    };
  }

  private triggerAlert(metrics: AlertMetrics): void {
    const alertData = {
      type: 'soroban_failure_spike',
      severity: this.determineSeverity(metrics),
      timestamp: new Date(),
      metrics,
      message: `Soroban failure rate exceeded threshold: ${metrics.failureCount} failures in ${this.timeWindowMs / 60000} minutes`,
    };

    this.logger.error(`ALERT: ${alertData.message}`, { metrics });
    
    // Emit alert event for notification services
    this.eventEmitter.emit('alert.soroban.failure', alertData);
  }

  private determineSeverity(metrics: AlertMetrics): 'low' | 'medium' | 'high' | 'critical' {
    if (metrics.failureRate > 20) return 'critical';
    if (metrics.failureRate > 10) return 'high';
    if (metrics.failureRate > 5) return 'medium';
    return 'low';
  }

  getMetrics(): AlertMetrics {
    return this.generateAlertMetrics();
  }

  getFailureHistory(limit = 100): SorobanFailure[] {
    return this.failures.slice(-limit);
  }

  clearHistory(): void {
    this.failures.length = 0;
    this.logger.log('Soroban failure history cleared');
  }
}