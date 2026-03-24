import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { SlaMetric, MetricType } from '../entities/sla-metric.entity';

export interface ThroughputStats {
  avgRpm: number;
  peakRpm: number;
  totalRequests: number;
  errorRatePercent: number;
}

@Injectable()
export class ThroughputMonitor {
  constructor(
    @InjectRepository(SlaMetric)
    private readonly metricRepo: Repository<SlaMetric>,
  ) {}

  async measure(agreementId: string, windowStart: Date, windowEnd: Date): Promise<ThroughputStats> {
    const [throughputMetrics, errorMetrics] = await Promise.all([
      this.metricRepo.find({
        where: { agreementId, type: MetricType.THROUGHPUT, recordedAt: Between(windowStart, windowEnd) },
      }),
      this.metricRepo.find({
        where: { agreementId, type: MetricType.ERROR_RATE, recordedAt: Between(windowStart, windowEnd) },
      }),
    ]);

    if (throughputMetrics.length === 0) return { avgRpm: 0, peakRpm: 0, totalRequests: 0, errorRatePercent: 0 };

    const rpms = throughputMetrics.map((m) => parseFloat(m.value));
    const avgRpm = rpms.reduce((s, v) => s + v, 0) / rpms.length;
    const peakRpm = Math.max(...rpms);
    const totalRequests = throughputMetrics.reduce((s, m) => s + m.sampleCount, 0);

    const avgErrorRate = errorMetrics.length > 0
      ? errorMetrics.reduce((s, m) => s + parseFloat(m.value), 0) / errorMetrics.length
      : 0;

    return {
      avgRpm: parseFloat(avgRpm.toFixed(2)),
      peakRpm,
      totalRequests,
      errorRatePercent: parseFloat(avgErrorRate.toFixed(4)),
    };
  }

  async record(agreementId: string, rpm: number, errorRatePercent: number, sampleCount: number): Promise<void> {
    await Promise.all([
      this.metricRepo.save(
        this.metricRepo.create({
          agreementId,
          type: MetricType.THROUGHPUT,
          value: rpm.toFixed(4),
          windowMinutes: 1,
          sampleCount,
          recordedAt: new Date(),
        }),
      ),
      this.metricRepo.save(
        this.metricRepo.create({
          agreementId,
          type: MetricType.ERROR_RATE,
          value: errorRatePercent.toFixed(4),
          windowMinutes: 1,
          sampleCount,
          recordedAt: new Date(),
        }),
      ),
    ]);
  }
}
