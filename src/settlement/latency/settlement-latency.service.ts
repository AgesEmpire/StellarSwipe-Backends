import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LatencyMetricDto } from './dto/latency-metric.dto';
import { aggregateLatencies, calculateLatencyMs, LatencySummary } from './utils/latency-calculator';

export interface SettlementLatencyAlert {
  tradeId: string;
  latencyMs: number;
  thresholdMs: number;
  triggeredAt: Date;
  reason: string;
}

interface ExecutedTradeRecord {
  tradeId: string;
  executedAt: Date;
  assetPair?: string;
}

@Injectable()
export class SettlementLatencyService {
  private readonly logger = new Logger(SettlementLatencyService.name);
  private readonly executedTrades = new Map<string, ExecutedTradeRecord>();
  private readonly metrics: LatencyMetricDto[] = [];
  private readonly alerts: SettlementLatencyAlert[] = [];
  private readonly thresholdMs: number;

  constructor(private readonly configService?: ConfigService) {
    const fromEnv = this.configService?.get<string>('SETTLEMENT_LATENCY_THRESHOLD_MS');
    this.thresholdMs = this.configService?.get<number>(
      'settlement.latencyThresholdMs',
      Number(fromEnv ?? 30_000),
    ) ?? Number(fromEnv ?? 30_000);
  }

  recordTradeExecution(tradeId: string, executedAt = new Date(), assetPair?: string): void {
    this.executedTrades.set(tradeId, {
      tradeId,
      executedAt,
      assetPair,
    });
  }

  recordSettlementCompletion(tradeId: string, settledAt = new Date()): LatencyMetricDto {
    const execution = this.executedTrades.get(tradeId);
    if (!execution) {
      throw new Error(`No execution timestamp recorded for trade ${tradeId}`);
    }

    const latencyMs = calculateLatencyMs(execution.executedAt, settledAt);
    const metric: LatencyMetricDto = {
      tradeId,
      executedAt: execution.executedAt.toISOString(),
      settledAt: settledAt.toISOString(),
      latencyMs,
      assetPair: execution.assetPair,
    };

    this.metrics.push(metric);
    this.executedTrades.delete(tradeId);
    this.evaluateThreshold(metric);

    return metric;
  }

  getMetrics(): LatencyMetricDto[] {
    return [...this.metrics];
  }

  getSummary(): LatencySummary {
    return aggregateLatencies(this.metrics.map((metric) => metric.latencyMs));
  }

  getAlerts(): SettlementLatencyAlert[] {
    return [...this.alerts];
  }

  clear(): void {
    this.executedTrades.clear();
    this.metrics.length = 0;
    this.alerts.length = 0;
  }

  private evaluateThreshold(metric: LatencyMetricDto): void {
    if (metric.latencyMs <= this.thresholdMs) return;

    const alert: SettlementLatencyAlert = {
      tradeId: metric.tradeId,
      latencyMs: metric.latencyMs,
      thresholdMs: this.thresholdMs,
      triggeredAt: new Date(),
      reason: `Settlement latency ${metric.latencyMs}ms exceeded threshold ${this.thresholdMs}ms`,
    };

    this.alerts.push(alert);
    this.logger.warn(alert.reason);
  }
}
