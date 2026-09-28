import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Trade, TradeStatus } from '../../trades/entities/trade.entity';
import { SuspiciousActivityReason } from './entities/suspicious-activity.entity';

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Single transaction USD value that triggers a large-transaction flag */
const LARGE_TX_THRESHOLD_USD = 10_000;

/** If a user executes this many trades within VELOCITY_WINDOW_MS, flag it */
const HIGH_VELOCITY_COUNT = 20;
const VELOCITY_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Structuring: multiple transactions whose individual values are just below
 * LARGE_TX_THRESHOLD_USD but whose total exceeds STRUCTURING_AGGREGATE_USD
 * within STRUCTURING_WINDOW_MS.
 */
const STRUCTURING_SINGLE_MAX_USD = 9_500;
const STRUCTURING_AGGREGATE_USD = 25_000;
const STRUCTURING_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const STRUCTURING_MIN_COUNT = 3;

/** Rapid fund movement: net in-then-out within this window */
const RAPID_MOVEMENT_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Dormant account: inactive for this many days, then suddenly active */
const DORMANT_DAYS = 90;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DetectedPattern {
  reason: SuspiciousActivityReason;
  riskScore: number;
  description: string;
  evidence: Record<string, unknown>;
  relatedTradeIds: string[];
  totalValueUsd: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class PatternDetectionService {
  private readonly logger = new Logger(PatternDetectionService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
  ) {}

  /**
   * Run all pattern detectors for a single user and return every detected
   * pattern. Callers decide what to do with the results.
   */
  async detectForUser(userId: string): Promise<DetectedPattern[]> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - STRUCTURING_WINDOW_MS);

    // Fetch the user's recent completed trades in one query
    const recentTrades = await this.tradeRepo.find({
      where: {
        userId,
        status: TradeStatus.SETTLED,
        createdAt: MoreThan(windowStart),
      },
      order: { createdAt: 'ASC' },
    });

    if (recentTrades.length === 0) return [];

    const detected: DetectedPattern[] = [];

    detected.push(
      ...this.checkHighVelocity(recentTrades),
      ...this.checkLargeTransaction(recentTrades),
      ...this.checkStructuring(recentTrades),
      ...this.checkRapidFundMovement(recentTrades),
      ...(await this.checkDormantAccountSpike(userId, recentTrades, now)),
    );

    return detected;
  }

  // ─── Detectors ──────────────────────────────────────────────────────────────

  private checkHighVelocity(trades: Trade[]): DetectedPattern[] {
    const now = Date.now();
    const window = trades.filter(
      (t) => now - t.createdAt.getTime() <= VELOCITY_WINDOW_MS,
    );

    if (window.length < HIGH_VELOCITY_COUNT) return [];

    return [
      {
        reason: SuspiciousActivityReason.HIGH_VELOCITY,
        riskScore: 65,
        description: `${window.length} trades executed within the last hour (threshold: ${HIGH_VELOCITY_COUNT}).`,
        evidence: {
          tradeCount: window.length,
          windowHours: 1,
          threshold: HIGH_VELOCITY_COUNT,
          firstTradeAt: window[0].createdAt,
          lastTradeAt: window[window.length - 1].createdAt,
        },
        relatedTradeIds: window.map((t) => t.id),
        totalValueUsd: window.reduce((s, t) => s + parseFloat(t.totalValue), 0),
      },
    ];
  }

  private checkLargeTransaction(trades: Trade[]): DetectedPattern[] {
    const large = trades.filter(
      (t) => parseFloat(t.totalValue) >= LARGE_TX_THRESHOLD_USD,
    );

    return large.map((t) => ({
      reason: SuspiciousActivityReason.LARGE_TRANSACTION,
      riskScore: 70,
      description: `Single trade of $${parseFloat(t.totalValue).toFixed(2)} exceeds the $${LARGE_TX_THRESHOLD_USD.toLocaleString()} threshold.`,
      evidence: {
        tradeId: t.id,
        amount: t.amount,
        totalValue: t.totalValue,
        baseAsset: t.baseAsset,
        counterAsset: t.counterAsset,
        side: t.side,
        executedAt: t.createdAt,
      },
      relatedTradeIds: [t.id],
      totalValueUsd: parseFloat(t.totalValue),
    }));
  }

  private checkStructuring(trades: Trade[]): DetectedPattern[] {
    const now = Date.now();
    const windowTrades = trades.filter(
      (t) =>
        now - t.createdAt.getTime() <= STRUCTURING_WINDOW_MS &&
        parseFloat(t.totalValue) <= STRUCTURING_SINGLE_MAX_USD,
    );

    if (windowTrades.length < STRUCTURING_MIN_COUNT) return [];

    const aggregate = windowTrades.reduce(
      (s, t) => s + parseFloat(t.totalValue),
      0,
    );

    if (aggregate < STRUCTURING_AGGREGATE_USD) return [];

    return [
      {
        reason: SuspiciousActivityReason.STRUCTURING,
        riskScore: 85,
        description: `${windowTrades.length} transactions each ≤$${STRUCTURING_SINGLE_MAX_USD.toLocaleString()} totalling $${aggregate.toFixed(2)} in 24 h — possible structuring to avoid reporting thresholds.`,
        evidence: {
          transactionCount: windowTrades.length,
          aggregateUsd: aggregate,
          singleMaxUsd: STRUCTURING_SINGLE_MAX_USD,
          windowHours: 24,
          values: windowTrades.map((t) => ({
            id: t.id,
            value: t.totalValue,
            at: t.createdAt,
          })),
        },
        relatedTradeIds: windowTrades.map((t) => t.id),
        totalValueUsd: aggregate,
      },
    ];
  }

  private checkRapidFundMovement(trades: Trade[]): DetectedPattern[] {
    const now = Date.now();
    const window = trades.filter(
      (t) => now - t.createdAt.getTime() <= RAPID_MOVEMENT_WINDOW_MS,
    );

    if (window.length < 2) return [];

    const buys = window.filter((t) => t.side === 'buy');
    const sells = window.filter((t) => t.side === 'sell');

    if (buys.length === 0 || sells.length === 0) return [];

    const buyTotal = buys.reduce((s, t) => s + parseFloat(t.totalValue), 0);
    const sellTotal = sells.reduce((s, t) => s + parseFloat(t.totalValue), 0);
    const minTotal = Math.min(buyTotal, sellTotal);

    // Flag if at least $5k moved in both directions within the window
    if (minTotal < 5_000) return [];

    return [
      {
        reason: SuspiciousActivityReason.RAPID_FUND_MOVEMENT,
        riskScore: 75,
        description: `$${buyTotal.toFixed(2)} bought and $${sellTotal.toFixed(2)} sold within 4 hours — rapid in/out movement pattern.`,
        evidence: {
          buyTotal,
          sellTotal,
          windowHours: 4,
          buyCount: buys.length,
          sellCount: sells.length,
        },
        relatedTradeIds: window.map((t) => t.id),
        totalValueUsd: buyTotal + sellTotal,
      },
    ];
  }

  private async checkDormantAccountSpike(
    userId: string,
    recentTrades: Trade[],
    now: Date,
  ): Promise<DetectedPattern[]> {
    const dormantCutoff = new Date(
      now.getTime() - DORMANT_DAYS * 24 * 60 * 60 * 1000,
    );

    // Check if there were ANY trades before the dormant window
    const preDormant = await this.tradeRepo.findOne({
      where: { userId, status: TradeStatus.SETTLED },
      order: { createdAt: 'DESC' },
    });

    if (!preDormant) return []; // New account — not dormant

    const daysSinceLastTrade = Math.floor(
      (now.getTime() - preDormant.createdAt.getTime()) / (24 * 60 * 60 * 1000),
    );

    if (daysSinceLastTrade < DORMANT_DAYS) return [];

    // Account was dormant — check if recent activity is significant
    const recentValue = recentTrades.reduce(
      (s, t) => s + parseFloat(t.totalValue),
      0,
    );

    if (recentValue < LARGE_TX_THRESHOLD_USD) return [];

    return [
      {
        reason: SuspiciousActivityReason.DORMANT_ACCOUNT_SPIKE,
        riskScore: 80,
        description: `Account dormant for ${daysSinceLastTrade} days suddenly executed $${recentValue.toFixed(2)} in trades.`,
        evidence: {
          dormantDays: daysSinceLastTrade,
          lastTradeBeforeDormancy: preDormant.createdAt,
          recentTradeCount: recentTrades.length,
          recentTotalUsd: recentValue,
        },
        relatedTradeIds: recentTrades.map((t) => t.id),
        totalValueUsd: recentValue,
      },
    ];
  }
}
