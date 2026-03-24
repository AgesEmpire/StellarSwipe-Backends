import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { SlaMetric, MetricType } from '../entities/sla-metric.entity';
import { UptimeMeasurement, computeMaxDowntime } from '../interfaces/uptime-requirement.interface';

@Injectable()
export class UptimeMonitor {
  constructor(
    @InjectRepository(SlaMetric)
    private readonly metricRepo: Repository<SlaMetric>,
  ) {}

  async measure(agreementId: string, windowStart: Date, windowEnd: Date, targetPercent: number): Promise<UptimeMeasurement> {
    const metrics = await this.metricRepo.find({
      where: { agreementId, type: MetricType.UPTIME, recordedAt: Between(windowStart, windowEnd) },
      order: { recordedAt: 'ASC' },
    });

    const totalMinutes = (windowEnd.getTime() - windowStart.getTime()) / 60000;

    // Each metric sample represents a window; value=0 means down, value=1 means up
    const downtimeMinutes = metrics.reduce((acc, m) => {
      return parseFloat(m.value) === 0 ? acc + m.windowMinutes : acc;
    }, 0);

    const uptimePercent = totalMinutes > 0
      ? ((totalMinutes - downtimeMinutes) / totalMinutes) * 100
      : 100;

    const maxAllowed = computeMaxDowntime(targetPercent, totalMinutes / 60);

    return {
      windowStart,
      windowEnd,
      totalMinutes,
      downtimeMinutes,
      uptimePercent: parseFloat(uptimePercent.toFixed(4)),
      breached: downtimeMinutes > maxAllowed,
    };
  }

  async record(agreementId: string, isUp: boolean, windowMinutes: number): Promise<void> {
    await this.metricRepo.save(
      this.metricRepo.create({
        agreementId,
        type: MetricType.UPTIME,
        value: isUp ? '1' : '0',
        windowMinutes,
        sampleCount: 1,
        recordedAt: new Date(),
      }),
    );
  }
}
