import { Injectable, Logger } from '@nestjs/common';
import * as os from 'os';
import { CpuSnapshot } from '../entities/performance-snapshot.entity';

export interface CpuSample {
  timestamp: Date;
  snapshot: CpuSnapshot;
}

@Injectable()
export class CpuProfiler {
  private readonly logger = new Logger(CpuProfiler.name);
  private prevCpuInfo: os.CpuInfo[] = [];

  /**
   * Capture a single CPU snapshot using os.cpus() delta measurement.
   */
  async capture(): Promise<CpuSample> {
    const timestamp = new Date();
    const currentCpuInfo = os.cpus();
    const cores = currentCpuInfo.length;

    let totalUsagePercent = 0;
    const perCoreUsage: number[] = [];

    currentCpuInfo.forEach((cpu, idx) => {
      const prev = this.prevCpuInfo[idx];
      if (!prev) {
        perCoreUsage.push(0);
        return;
      }

      const prevTotal = Object.values(prev.times).reduce((a, b) => a + b, 0);
      const currTotal = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const totalDiff = currTotal - prevTotal;
      const idleDiff = cpu.times.idle - prev.times.idle;

      const usagePercent = totalDiff === 0 ? 0 : ((totalDiff - idleDiff) / totalDiff) * 100;
      perCoreUsage.push(Math.round(usagePercent * 100) / 100);
      totalUsagePercent += usagePercent;
    });

    this.prevCpuInfo = currentCpuInfo;

    const avgUsage =
      perCoreUsage.length > 0 ? totalUsagePercent / perCoreUsage.length : 0;

    const loadAvg = os.loadavg();

    const processUsage = process.cpuUsage();

    const snapshot: CpuSnapshot = {
      usagePercent: Math.round(avgUsage * 100) / 100,
      userTimeMs: Math.round(processUsage.user / 1000),
      systemTimeMs: Math.round(processUsage.system / 1000),
      idlePercent: Math.round((100 - avgUsage) * 100) / 100,
      loadAvg1m: Math.round(loadAvg[0] * 100) / 100,
      loadAvg5m: Math.round(loadAvg[1] * 100) / 100,
      loadAvg15m: Math.round(loadAvg[2] * 100) / 100,
      cores,
      perCoreUsage,
    };

    return { timestamp, snapshot };
  }

  /**
   * Collect samples over a duration at a given interval.
   */
  async collectSamples(
    durationMs: number,
    intervalMs: number,
    onSample: (sample: CpuSample) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const end = Date.now() + durationMs;

    // Warm up — prime the delta baseline
    this.prevCpuInfo = os.cpus();
    await this.sleep(Math.min(intervalMs, 500));

    while (Date.now() < end && !signal.aborted) {
      try {
        const sample = await this.capture();
        onSample(sample);
      } catch (err) {
        this.logger.warn(`CPU sample capture failed: ${err.message}`);
      }
      await this.sleep(intervalMs);
    }
  }

  computeStats(samples: CpuSample[]): {
    avg: number;
    peak: number;
    p95: number;
    peakAt: Date;
  } {
    if (!samples.length) return { avg: 0, peak: 0, p95: 0, peakAt: new Date() };

    const usages = samples.map((s) => s.snapshot.usagePercent).sort((a, b) => a - b);
    const peakIdx = usages.indexOf(Math.max(...usages));

    return {
      avg: Math.round((usages.reduce((a, b) => a + b, 0) / usages.length) * 100) / 100,
      peak: usages[usages.length - 1],
      p95: usages[Math.floor(usages.length * 0.95)] ?? usages[usages.length - 1],
      peakAt: samples[peakIdx]?.timestamp ?? new Date(),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
