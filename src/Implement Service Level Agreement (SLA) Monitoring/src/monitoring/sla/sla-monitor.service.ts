import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SlaMetric } from './entities/sla-metric.entity';

export interface SlaThreshold {
  service: string;
  maxResponseTime: number;
  minUptimePercentage: number;
}

export interface SlaCheckResult {
  service: string;
  responseTime: number;
  isAvailable: boolean;
  breached: boolean;
  breachReason?: string;
}

@Injectable()
export class SlaMonitorService {
  private readonly logger = new Logger(SlaMonitorService.name);
  private readonly thresholds: Map<string, SlaThreshold> = new Map();

  constructor(
    @InjectRepository(SlaMetric)
    private readonly slaMetricRepository: Repository<SlaMetric>,
  ) {
    this.initializeThresholds();
  }

  private initializeThresholds() {
    this.thresholds.set('api', {
      service: 'api',
      maxResponseTime: 500,
      minUptimePercentage: 99.9,
    });
    this.thresholds.set('database', {
      service: 'database',
      maxResponseTime: 100,
      minUptimePercentage: 99.95,
    });
  }

  async recordMetric(
    service: string,
    responseTime: number,
    isAvailable: boolean,
    metadata?: Record<string, any>,
  ): Promise<SlaMetric> {
    const threshold = this.thresholds.get(service);
    let breached = false;
    let breachReason: string | undefined;

    if (threshold) {
      if (!isAvailable) {
        breached = true;
        breachReason = 'Service unavailable';
      } else if (responseTime > threshold.maxResponseTime) {
        breached = true;
        breachReason = `Response time ${responseTime}ms exceeds threshold ${threshold.maxResponseTime}ms`;
      }
    }

    const metric = this.slaMetricRepository.create({
      service,
      responseTime,
      isAvailable,
      breached,
      breachReason,
      metadata,
    });

    const savedMetric = await this.slaMetricRepository.save(metric);

    if (breached) {
      this.logger.warn(`SLA breach detected for ${service}: ${breachReason}`);
      await this.handleBreach(savedMetric);
    }

    return savedMetric;
  }

  async checkService(service: string, healthCheckFn: () => Promise<number>): Promise<SlaCheckResult> {
    let responseTime: number;
    let isAvailable = true;
    let breached = false;
    let breachReason: string | undefined;

    try {
      const startTime = Date.now();
      await healthCheckFn();
      responseTime = Date.now() - startTime;
    } catch (error) {
      responseTime = 0;
      isAvailable = false;
      breached = true;
      breachReason = `Health check failed: ${error.message}`;
    }

    await this.recordMetric(service, responseTime, isAvailable);

    const threshold = this.thresholds.get(service);
    if (threshold && isAvailable && responseTime > threshold.maxResponseTime) {
      breached = true;
      breachReason = `Response time ${responseTime}ms exceeds threshold`;
    }

    return { service, responseTime, isAvailable, breached, breachReason };
  }

  async calculateUptime(service: string, hours: number = 24): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const [total, available] = await Promise.all([
      this.slaMetricRepository.count({
        where: { service, timestamp: Between(since, new Date()) },
      }),
      this.slaMetricRepository.count({
        where: { service, isAvailable: true, timestamp: Between(since, new Date()) },
      }),
    ]);

    return total > 0 ? (available / total) * 100 : 100;
  }

  async getAverageResponseTime(service: string, hours: number = 24): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const result = await this.slaMetricRepository
      .createQueryBuilder('metric')
      .select('AVG(metric.responseTime)', 'avg')
      .where('metric.service = :service', { service })
      .andWhere('metric.timestamp >= :since', { since })
      .andWhere('metric.isAvailable = :available', { available: true })
      .getRawOne();

    return result?.avg ? parseFloat(result.avg) : 0;
  }

  async getBreaches(service: string, hours: number = 24): Promise<SlaMetric[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    return this.slaMetricRepository.find({
      where: {
        service,
        breached: true,
        timestamp: Between(since, new Date()),
      },
      order: { timestamp: 'DESC' },
    });
  }

  private async handleBreach(metric: SlaMetric): Promise<void> {
    this.logger.error(`SLA Breach Alert: ${metric.service} - ${metric.breachReason}`);
  }

  setThreshold(service: string, threshold: SlaThreshold): void {
    this.thresholds.set(service, threshold);
  }

  getThreshold(service: string): SlaThreshold | undefined {
    return this.thresholds.get(service);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async updateUptimeMetrics(): Promise<void> {
    for (const [service] of this.thresholds) {
      const uptime = await this.calculateUptime(service, 1);
      
      const latestMetric = await this.slaMetricRepository.findOne({
        where: { service },
        order: { timestamp: 'DESC' },
      });

      if (latestMetric) {
        latestMetric.uptimePercentage = uptime;
        await this.slaMetricRepository.save(latestMetric);
      }
    }
  }
}
