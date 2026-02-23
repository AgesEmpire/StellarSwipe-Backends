import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { SlaMetric } from './entities/sla-metric.entity';
import { SlaMonitorService } from './sla-monitor.service';

export interface SlaReport {
  service: string;
  period: {
    start: Date;
    end: Date;
    hours: number;
  };
  uptime: {
    percentage: number;
    totalChecks: number;
    availableChecks: number;
    unavailableChecks: number;
  };
  responseTime: {
    average: number;
    min: number;
    max: number;
    p95: number;
    p99: number;
  };
  breaches: {
    total: number;
    byReason: Record<string, number>;
    incidents: Array<{
      timestamp: Date;
      reason: string;
      responseTime: number;
    }>;
  };
  compliance: {
    met: boolean;
    threshold: number;
    actual: number;
  };
}

@Injectable()
export class SlaReporterService {
  private readonly logger = new Logger(SlaReporterService.name);

  constructor(
    @InjectRepository(SlaMetric)
    private readonly slaMetricRepository: Repository<SlaMetric>,
    private readonly slaMonitorService: SlaMonitorService,
  ) {}

  async generateReport(service: string, hours: number = 24): Promise<SlaReport> {
    const end = new Date();
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);

    const metrics = await this.slaMetricRepository.find({
      where: {
        service,
        timestamp: Between(start, end),
      },
      order: { timestamp: 'ASC' },
    });

    const uptime = await this.calculateUptimeStats(metrics);
    const responseTime = await this.calculateResponseTimeStats(metrics);
    const breaches = await this.calculateBreachStats(metrics);
    const compliance = await this.calculateCompliance(service, uptime.percentage);

    return {
      service,
      period: { start, end, hours },
      uptime,
      responseTime,
      breaches,
      compliance,
    };
  }

  private async calculateUptimeStats(metrics: SlaMetric[]) {
    const totalChecks = metrics.length;
    const availableChecks = metrics.filter(m => m.isAvailable).length;
    const unavailableChecks = totalChecks - availableChecks;
    const percentage = totalChecks > 0 ? (availableChecks / totalChecks) * 100 : 100;

    return {
      percentage: parseFloat(percentage.toFixed(4)),
      totalChecks,
      availableChecks,
      unavailableChecks,
    };
  }

  private async calculateResponseTimeStats(metrics: SlaMetric[]) {
    const availableMetrics = metrics.filter(m => m.isAvailable);
    
    if (availableMetrics.length === 0) {
      return { average: 0, min: 0, max: 0, p95: 0, p99: 0 };
    }

    const responseTimes = availableMetrics.map(m => m.responseTime).sort((a, b) => a - b);
    const sum = responseTimes.reduce((acc, val) => acc + val, 0);
    const average = sum / responseTimes.length;

    const p95Index = Math.floor(responseTimes.length * 0.95);
    const p99Index = Math.floor(responseTimes.length * 0.99);

    return {
      average: parseFloat(average.toFixed(2)),
      min: responseTimes[0],
      max: responseTimes[responseTimes.length - 1],
      p95: responseTimes[p95Index] || 0,
      p99: responseTimes[p99Index] || 0,
    };
  }

  private async calculateBreachStats(metrics: SlaMetric[]) {
    const breachedMetrics = metrics.filter(m => m.breached);
    const byReason: Record<string, number> = {};

    breachedMetrics.forEach(metric => {
      const reason = metric.breachReason || 'Unknown';
      byReason[reason] = (byReason[reason] || 0) + 1;
    });

    const incidents = breachedMetrics.map(m => ({
      timestamp: m.timestamp,
      reason: m.breachReason || 'Unknown',
      responseTime: m.responseTime,
    }));

    return {
      total: breachedMetrics.length,
      byReason,
      incidents,
    };
  }

  private async calculateCompliance(service: string, actualUptime: number) {
    const threshold = this.slaMonitorService.getThreshold(service);
    const minUptime = threshold?.minUptimePercentage || 99.9;

    return {
      met: actualUptime >= minUptime,
      threshold: minUptime,
      actual: actualUptime,
    };
  }

  async getDashboardData(services: string[], hours: number = 24) {
    const reports = await Promise.all(
      services.map(service => this.generateReport(service, hours)),
    );

    return {
      timestamp: new Date(),
      period: { hours },
      services: reports.map(report => ({
        name: report.service,
        uptime: report.uptime.percentage,
        avgResponseTime: report.responseTime.average,
        breaches: report.breaches.total,
        compliant: report.compliance.met,
      })),
      summary: {
        totalServices: services.length,
        compliantServices: reports.filter(r => r.compliance.met).length,
        totalBreaches: reports.reduce((sum, r) => sum + r.breaches.total, 0),
        avgUptime: reports.reduce((sum, r) => sum + r.uptime.percentage, 0) / reports.length,
      },
    };
  }

  async exportReport(service: string, hours: number = 24): Promise<string> {
    const report = await this.generateReport(service, hours);
    return JSON.stringify(report, null, 2);
  }
}
