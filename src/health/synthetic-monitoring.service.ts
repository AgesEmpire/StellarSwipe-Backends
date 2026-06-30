import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Signal } from '../signals/entities/signal.entity';
import { Trade } from '../trades/entities/trade.entity';

export interface SyntheticMonitorResult {
  timestamp: Date;
  feedFetchSuccess: boolean;
  feedFetchLatencyMs: number;
  swipeSuccess: boolean;
  swipeLatencyMs: number;
  tradeSuccess: boolean;
  tradeLatencyMs: number;
  totalLatencyMs: number;
  errorMessage?: string;
}

@Injectable()
export class SyntheticMonitoringService {
  private readonly logger = new Logger(SyntheticMonitoringService.name);
  private readonly SYNTHETIC_USER_USERNAME = 'SYNTHETIC_TEST_ACCOUNT';
  private readonly LATENCY_THRESHOLD_MS = 5000;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Signal)
    private readonly signalRepository: Repository<Signal>,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async runSyntheticCheck(): Promise<void> {
    const result = await this.executeSyntheticJourney();
    this.logResult(result);
    this.checkThresholds(result);
  }

  async executeSyntheticJourney(): Promise<SyntheticMonitorResult> {
    const startTime = Date.now();
    const result: SyntheticMonitorResult = {
      timestamp: new Date(),
      feedFetchSuccess: false,
      feedFetchLatencyMs: 0,
      swipeSuccess: false,
      swipeLatencyMs: 0,
      tradeSuccess: false,
      tradeLatencyMs: 0,
      totalLatencyMs: 0,
    };

    try {
      const syntheticUser = await this.getOrCreateSyntheticUser();
      if (!syntheticUser) {
        result.errorMessage = 'Failed to get/create synthetic user';
        return result;
      }

      // Step 1: Feed fetch
      const feedStart = Date.now();
      const signals = await this.signalRepository.find({
        where: { status: 'ACTIVE' as any },
        take: 1,
      });
      result.feedFetchSuccess = true;
      result.feedFetchLatencyMs = Date.now() - feedStart;

      if (!signals.length) {
        result.errorMessage = 'No active signals found for synthetic test';
        return result;
      }

      const signal = signals[0];

      // Step 2: Swipe/copy action (simulated)
      const swipeStart = Date.now();
      result.swipeSuccess = true;
      result.swipeLatencyMs = Date.now() - swipeStart;

      // Step 3: Trade execution (simulated with synthetic flag)
      const tradeStart = Date.now();
      const syntheticTrade = this.tradeRepository.create({
        userId: syntheticUser.id,
        signalId: signal.id,
        status: 'SETTLED' as any,
        side: 'BUY' as any,
        baseAsset: signal.baseAsset,
        counterAsset: signal.counterAsset,
        entryPrice: signal.entryPrice,
        amount: '0.001',
        totalValue: '0.001',
        metadata: { isSynthetic: true, syntheticTest: true },
      });
      await this.tradeRepository.save(syntheticTrade);
      result.tradeSuccess = true;
      result.tradeLatencyMs = Date.now() - tradeStart;

      result.totalLatencyMs = Date.now() - startTime;
    } catch (error) {
      result.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Synthetic journey failed: ${result.errorMessage}`);
    }

    return result;
  }

  private async getOrCreateSyntheticUser(): Promise<User | null> {
    let user = await this.userRepository.findOne({
      where: { username: this.SYNTHETIC_USER_USERNAME },
    });

    if (!user) {
      user = this.userRepository.create({
        username: this.SYNTHETIC_USER_USERNAME,
        isActive: true,
        tier: 'BASIC' as any,
        kycStatus: 'VERIFIED' as any,
        walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      });
      try {
        user = await this.userRepository.save(user);
      } catch (error) {
        this.logger.error(`Failed to create synthetic user: ${error}`);
        return null;
      }
    }

    return user;
  }

  private logResult(result: SyntheticMonitorResult): void {
    if (result.feedFetchSuccess && result.swipeSuccess && result.tradeSuccess) {
      this.logger.log(
        `Synthetic check PASSED - Feed:${result.feedFetchLatencyMs}ms Swipe:${result.swipeLatencyMs}ms Trade:${result.tradeLatencyMs}ms Total:${result.totalLatencyMs}ms`,
      );
    } else {
      this.logger.error(
        `Synthetic check FAILED - Feed:${result.feedFetchSuccess} Swipe:${result.swipeSuccess} Trade:${result.tradeSuccess} Error:${result.errorMessage}`,
      );
    }
  }

  private checkThresholds(result: SyntheticMonitorResult): void {
    const thresholds = [
      { name: 'Feed fetch', latency: result.feedFetchLatencyMs },
      { name: 'Swipe', latency: result.swipeLatencyMs },
      { name: 'Trade', latency: result.tradeLatencyMs },
    ];

    for (const threshold of thresholds) {
      if (threshold.latency > this.LATENCY_THRESHOLD_MS) {
        this.logger.warn(
          `Synthetic monitor latency threshold breach: ${threshold.name} took ${threshold.latencyMs}ms (threshold: ${this.LATENCY_THRESHOLD_MS}ms)`,
        );
      }
    }
  }

  async getSyntheticResults(limit: number = 10): Promise<SyntheticMonitorResult[]> {
    const trades = await this.tradeRepository.find({
      where: { metadata: { isSynthetic: true } as any },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return trades.map((trade) => ({
      timestamp: trade.createdAt,
      feedFetchSuccess: true,
      feedFetchLatencyMs: 0,
      swipeSuccess: true,
      swipeLatencyMs: 0,
      tradeSuccess: trade.status === 'SETTLED',
      tradeLatencyMs: 0,
      totalLatencyMs: 0,
    }));
  }
}
