import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { SlaMetric, MetricType } from '../entities/sla-metric.entity';

export interface ResponseTimeStats {
  avg: number;
  p95: number;
  p99: number;
  sampleCount: number;
}

@Injectable()
export class ResponseTimeMonitor {
  constructor(
    @InjectRepository(SlaMetric)
    private readonly metricRepo: Repository<SlaMetric>,
  ) {}

  async measure(agreementId: string, windowStart: Date, windowEnd: Date): Promise<ResponseTimeStats> {
    const metrics = await this.metricRepo.find({
      where: { agreementId, type: MetricType.RESPONSE_TIME, recordedAt: Between(windowStart, windowEnd) },
      order: { recordedAt: 'ASC' },
    });

    if (metrics.length === 0) return { avg: 0, p95: 0, p99: 0, sampleCount: 0 };

    const values = metrics.map((m) => parseFloat(m.value)).sort((a, b) => a - b);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const p95 = values[Math.floor(values.length * 0.95)] ?? values[values.length - 1];
    const p99 = values[Math.floor(values.length * 0.99)] ?? values[values.length - 1];

    return { avg: parseFloat(avg.toFixed(2)), p95, p99, sampleCount: values.length };
  }

  async record(agreementId: string, responseTimeMs: number, windowMinutes = 1): Promise<void> {
    await this.metricRepo.save(
      this.metricRepo.create({
        agreementId,
        type: MetricType.RESPONSE_TIME,
        value: responseTimeMs.toFixed(4),
        windowMinutes,
        sampleCount: 1,
        recordedAt: new Date(),
      }),
    );
  }
}
