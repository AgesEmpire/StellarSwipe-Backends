import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BenchmarkService } from '../benchmark.service';

@Injectable()
export class CalculateBenchmarksJob {
  private readonly logger = new Logger(CalculateBenchmarksJob.name);
  private isRunning = false;

  constructor(private readonly benchmarkService: BenchmarkService) {}

  /**
   * Recalculate platform benchmarks nightly.
   * Provider metrics are expected to be sourced externally (e.g. from a metrics service).
   * This job acts as an orchestration hook — inject the metrics provider as needed.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleNightlyBenchmarkCalculation(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Benchmark calculation already running — skipping.');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting nightly benchmark calculation...');

    try {
      // In production, inject a MetricsAggregatorService to supply provider metrics.
      // For now this is a no-op placeholder that demonstrates the orchestration pattern.
      this.logger.warn(
        'No metrics source injected into CalculateBenchmarksJob. Provide a MetricsAggregatorService.',
      );
    } catch (err) {
      this.logger.error(
        'Nightly benchmark calculation failed.',
        (err as Error).stack,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
