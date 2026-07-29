import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import {
  Signal,
  SignalStatus,
  SignalOutcome,
  SignalType,
} from '../entities/signal.entity';
import { SignalPerformance } from '../entities/signal-performance.entity';

export interface SignalOutcomeRecord {
  signalId: string;
  providerId: string;
  outcome: SignalOutcome;
  exitPrice: number;
  copierCount: number;
  resolvedAt?: Date;
}

export interface ProviderPerformanceSummary {
  providerId: string;
  periodStart: Date;
  periodEnd: Date;
  totalSignals: number;
  resolvedSignals: number;
  successfulSignals: number;
  failedSignals: number;
  expiredSignals: number;
  successRate: number;
  avgReturnPct: number;
  bestReturnPct: number;
  worstReturnPct: number;
  totalCopiers: number;
  avgResolutionHours: number;
}

@Injectable()
export class ProviderPerformanceTrackerService {
  private readonly logger = new Logger(ProviderPerformanceTrackerService.name);

  constructor(
    @InjectRepository(Signal)
    private readonly signalRepository: Repository<Signal>,
    @InjectRepository(SignalPerformance)
    private readonly performanceRepository: Repository<SignalPerformance>,
  ) {}

  /**
   * Records a trade outcome on a signal and updates the daily performance snapshot.
   * Called when a copied position closes (target hit, stop hit, or expiry).
   */
  async recordSignalOutcome(record: SignalOutcomeRecord): Promise<Signal> {
    const signal = await this.signalRepository.findOne({
      where: { id: record.signalId, providerId: record.providerId },
    });

    if (!signal) {
      throw new NotFoundException(`Signal ${record.signalId} not found for provider ${record.providerId}`);
    }

    const returnPct = this.computeReturnPct(signal, record.exitPrice);

    signal.outcome = record.outcome;
    signal.status = SignalStatus.CLOSED;
    (signal as any).exitPrice = record.exitPrice.toString();
    (signal as any).returnPct = returnPct.toFixed(4);
    (signal as any).resolvedAt = record.resolvedAt ?? new Date();

    const saved = await this.signalRepository.save(signal);

    await this.upsertDailySnapshot(signal.providerId, record, returnPct);

    this.logger.log(
      `Signal ${record.signalId} resolved: ${record.outcome}, return: ${returnPct.toFixed(2)}%`,
    );

    return saved;
  }

  /**
   * Aggregates performance metrics for a provider across a date range.
   * Uses the daily SignalPerformance snapshots for efficient aggregation.
   */
  async aggregateProviderPerformance(
    providerId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<ProviderPerformanceSummary> {
    const snapshots = await this.performanceRepository.find({
      where: {
        providerId,
        date: Between(periodStart, periodEnd) as any,
      },
    });

    if (snapshots.length === 0) {
      return this.emptyPerformanceSummary(providerId, periodStart, periodEnd);
    }

    const totalSignals     = snapshots.reduce((s, r) => s + r.totalSignals, 0);
    const successfulSignals = snapshots.reduce((s, r) => s + r.successfulSignals, 0);
    const failedSignals    = snapshots.reduce((s, r) => s + (r as any).failedSignals ?? r.closedSignals - r.successfulSignals, 0);
    const expiredSignals   = snapshots.reduce((s, r) => s + r.expiredSignals, 0);
    const resolvedSignals  = successfulSignals + failedSignals + expiredSignals;
    const totalCopiers     = snapshots.reduce((s, r) => s + r.totalCopiers, 0);

    const returnPcts: number[] = snapshots
      .map((r) => Number((r as any).avgReturnPct ?? 0))
      .filter((v) => !isNaN(v));

    const avgReturnPct   = returnPcts.length > 0 ? returnPcts.reduce((a, b) => a + b, 0) / returnPcts.length : 0;
    const bestReturnPct  = returnPcts.length > 0 ? Math.max(...returnPcts) : 0;
    const worstReturnPct = returnPcts.length > 0 ? Math.min(...returnPcts) : 0;

    const holdTimes = snapshots.map((r) => r.averageHoldTimeSeconds ?? 0);
    const avgResolutionHours = holdTimes.length > 0
      ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length / 3600
      : 0;

    return {
      providerId,
      periodStart,
      periodEnd,
      totalSignals,
      resolvedSignals,
      successfulSignals,
      failedSignals,
      expiredSignals,
      successRate: resolvedSignals > 0 ? parseFloat((successfulSignals / resolvedSignals).toFixed(4)) : 0,
      avgReturnPct: parseFloat(avgReturnPct.toFixed(4)),
      bestReturnPct: parseFloat(bestReturnPct.toFixed(4)),
      worstReturnPct: parseFloat(worstReturnPct.toFixed(4)),
      totalCopiers,
      avgResolutionHours: parseFloat(avgResolutionHours.toFixed(2)),
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Computes % return for a signal.
   * BUY:  (exitPrice - entryPrice) / entryPrice × 100
   * SELL: (entryPrice - exitPrice) / entryPrice × 100
   */
  computeReturnPct(signal: Signal, exitPrice: number): number {
    const entry = parseFloat(signal.entryPrice as any);
    if (entry === 0) return 0;
    return signal.type === SignalType.BUY
      ? ((exitPrice - entry) / entry) * 100
      : ((entry - exitPrice) / entry) * 100;
  }

  private async upsertDailySnapshot(
    providerId: string,
    record: SignalOutcomeRecord,
    returnPct: number,
  ): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let snapshot = await this.performanceRepository.findOne({
      where: { providerId, date: today as any },
    });

    if (!snapshot) {
      snapshot = this.performanceRepository.create({
        providerId,
        date: today,
        totalSignals: 0,
        activeSignals: 0,
        closedSignals: 0,
        successfulSignals: 0,
        expiredSignals: 0,
        totalCopiers: 0,
      } as any);
    }

    snapshot.closedSignals = (snapshot.closedSignals ?? 0) + 1;

    if (record.outcome === SignalOutcome.TARGET_HIT) {
      snapshot.successfulSignals = (snapshot.successfulSignals ?? 0) + 1;
    } else if (record.outcome === SignalOutcome.EXPIRED) {
      snapshot.expiredSignals = (snapshot.expiredSignals ?? 0) + 1;
    }

    snapshot.totalCopiers = Math.max(snapshot.totalCopiers ?? 0, record.copierCount);
    (snapshot as any).avgReturnPct = returnPct;

    await this.performanceRepository.save(snapshot);
  }

  private emptyPerformanceSummary(
    providerId: string,
    periodStart: Date,
    periodEnd: Date,
  ): ProviderPerformanceSummary {
    return {
      providerId,
      periodStart,
      periodEnd,
      totalSignals: 0,
      resolvedSignals: 0,
      successfulSignals: 0,
      failedSignals: 0,
      expiredSignals: 0,
      successRate: 0,
      avgReturnPct: 0,
      bestReturnPct: 0,
      worstReturnPct: 0,
      totalCopiers: 0,
      avgResolutionHours: 0,
    };
  }
}
