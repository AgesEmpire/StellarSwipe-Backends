import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Histogram, Counter, Gauge, Registry } from 'prom-client';
import { PrometheusService } from '../../monitoring/metrics/prometheus.service';

export enum TradeStage {
  VALIDATION = 'validation',
  CREATION = 'creation',
  EXECUTION = 'execution',
  CONFIRMATION = 'confirmation',
  SETTLEMENT = 'settlement',
  END_TO_END = 'end_to_end',
}

export interface TradeLatencySnapshot {
  tradeId: string;
  stages: Partial<Record<TradeStage, number>>;
  totalMs?: number;
  startedAt: Date;
  slow: boolean;
}

/**
 * TradeLatencyService
 *
 * Records timestamps at each key stage of the trade workflow and exposes
 * per-stage and end-to-end latency metrics to Prometheus.
 *
 * Stages measured:
 *  validation   – compliance + risk manager checks
 *  creation     – trade entity persisted to DB
 *  execution    – Stellar transaction submitted
 *  confirmation – tx included in a ledger
 *  settlement   – SDEX order fully settled
 *  end_to_end   – validation → settlement wall-clock time
 *
 * Prometheus metrics:
 *  trade_stage_duration_seconds   histogram – per-stage latency
 *  trade_end_to_end_duration_seconds histogram – total flow latency
 *  trade_slow_flows_total         counter   – flows exceeding slowThresholdMs
 *  trade_active_flows             gauge     – flows currently in-progress
 */
@Injectable()
export class TradeLatencyService implements OnModuleInit {
  private readonly logger = new Logger(TradeLatencyService.name);

  private stageDuration!: Histogram;
  private endToEndDuration!: Histogram;
  private slowFlowsCounter!: Counter;
  private activeFlowsGauge!: Gauge;

  /** ms threshold above which a completed trade flow is considered slow */
  private readonly slowThresholdMs: number;

  /** tradeId → start timestamps per stage */
  private readonly stageTimes = new Map<string, Partial<Record<TradeStage, number>>>();
  /** tradeId → wall-clock start (ms) of the whole flow */
  private readonly flowStart = new Map<string, number>();

  constructor(
    private readonly prometheusService: PrometheusService,
    private readonly configService: ConfigService,
  ) {
    this.slowThresholdMs = this.configService.get<number>(
      'monitoring.tradeSlowThresholdMs',
      5_000,
    );
  }

  onModuleInit(): void {
    const registry: Registry = this.prometheusService.registry;

    this.stageDuration = new Histogram({
      name: 'trade_stage_duration_seconds',
      help: 'Duration of individual trade workflow stages in seconds',
      labelNames: ['stage', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [registry],
    });

    this.endToEndDuration = new Histogram({
      name: 'trade_end_to_end_duration_seconds',
      help: 'Total wall-clock duration of a complete trade flow in seconds',
      labelNames: ['status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
      registers: [registry],
    });

    this.slowFlowsCounter = new Counter({
      name: 'trade_slow_flows_total',
      help: `Total trade flows that exceeded the slow threshold (${this.slowThresholdMs} ms)`,
      labelNames: ['stage'],
      registers: [registry],
    });

    this.activeFlowsGauge = new Gauge({
      name: 'trade_active_flows',
      help: 'Number of trade flows currently in progress',
      registers: [registry],
    });

    this.logger.log(`TradeLatencyService initialised (slowThreshold=${this.slowThresholdMs}ms)`);
  }

  /**
   * Call once when a new trade flow begins (before validation).
   * Returns a handle tied to the tradeId for subsequent stage calls.
   */
  startFlow(tradeId: string): void {
    this.flowStart.set(tradeId, performance.now());
    this.stageTimes.set(tradeId, {});
    this.activeFlowsGauge.inc();
  }

  /**
   * Mark the start of a named stage. Pair with {@link endStage}.
   */
  startStage(tradeId: string, stage: TradeStage): void {
    const stages = this.stageTimes.get(tradeId);
    if (!stages) return;
    stages[stage] = performance.now();
  }

  /**
   * Mark the end of a named stage and record its duration.
   *
   * @param status  'success' or 'failure' – attached as a Prometheus label
   */
  endStage(tradeId: string, stage: TradeStage, status: 'success' | 'failure' = 'success'): void {
    const stages = this.stageTimes.get(tradeId);
    if (!stages || stages[stage] === undefined) return;

    const durationSeconds = (performance.now() - stages[stage]!) / 1000;
    this.stageDuration.observe({ stage, status }, durationSeconds);

    if (durationSeconds * 1000 > this.slowThresholdMs) {
      this.slowFlowsCounter.inc({ stage });
      this.logger.warn(
        `[TradeLatency] trade=${tradeId} stage=${stage} took ${(durationSeconds * 1000).toFixed(1)}ms (slow)`,
      );
    }

    // Clear the start timestamp so we can detect mis-use
    stages[stage] = undefined;
  }

  /**
   * Finalise the entire flow. Records end-to-end duration and cleans up state.
   */
  endFlow(tradeId: string, status: 'success' | 'failure' = 'success'): TradeLatencySnapshot {
    const flowStartMs = this.flowStart.get(tradeId);
    const stages = this.stageTimes.get(tradeId) ?? {};

    let totalMs: number | undefined;
    if (flowStartMs !== undefined) {
      totalMs = performance.now() - flowStartMs;
      const durationSeconds = totalMs / 1000;
      this.endToEndDuration.observe({ status }, durationSeconds);

      if (totalMs > this.slowThresholdMs) {
        this.slowFlowsCounter.inc({ stage: TradeStage.END_TO_END });
        this.logger.warn(
          `[TradeLatency] trade=${tradeId} end-to-end took ${totalMs.toFixed(1)}ms (slow)`,
        );
      }
    }

    this.flowStart.delete(tradeId);
    this.stageTimes.delete(tradeId);
    this.activeFlowsGauge.dec();

    const snapshot: TradeLatencySnapshot = {
      tradeId,
      stages,
      totalMs,
      startedAt: flowStartMs ? new Date(Date.now() - (totalMs ?? 0)) : new Date(),
      slow: (totalMs ?? 0) > this.slowThresholdMs,
    };

    this.logger.debug(
      `[TradeLatency] trade=${tradeId} status=${status} total=${totalMs?.toFixed(1)}ms`,
    );

    return snapshot;
  }

  /**
   * Convenience wrapper: runs `fn`, records stage latency, and re-throws on error.
   */
  async measureStage<T>(
    tradeId: string,
    stage: TradeStage,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.startStage(tradeId, stage);
    try {
      const result = await fn();
      this.endStage(tradeId, stage, 'success');
      return result;
    } catch (error) {
      this.endStage(tradeId, stage, 'failure');
      throw error;
    }
  }
}
