import {
  Injectable,
  Logger,
  OnModuleInit,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Achievement, AchievementCriteria } from './entities/achievement.entity';
import { UserAchievement } from './entities/user-achievement.entity';
import {
  UserAchievementsResponseDto,
  TradeExecutedPayload,
  SignalCreatedPayload,
  SignalCopiedPayload,
} from './dto/user-achievements.dto';

// ─── Seed data ───────────────────────────────────────────────────────────────

const SEED_ACHIEVEMENTS: Omit<Achievement, 'id' | 'userAchievements' | 'createdAt' | 'updatedAt'>[] = [
  {
    key: 'first_trade',
    name: 'First Swipe',
    description: 'Execute your very first trade.',
    criteria: { type: 'trade_count', count: 1 },
    badgeImage: 'badges/first_trade.svg',
    rarity: 'common',
    isActive: true,
  },
  {
    key: 'ten_trades',
    name: 'Getting Started',
    description: 'Execute 10 trades.',
    criteria: { type: 'trade_count', count: 10 },
    badgeImage: 'badges/ten_trades.svg',
    rarity: 'common',
    isActive: true,
  },
  {
    key: 'hot_streak',
    name: 'Hot Streak',
    description: '5 profitable trades in a row.',
    criteria: { type: 'win_streak', streak: 5 },
    badgeImage: 'badges/hot_streak.svg',
    rarity: 'rare',
    isActive: true,
  },
  {
    key: 'provider',
    name: 'Provider',
    description: 'Create your first signal.',
    criteria: { type: 'signal_count', count: 1 },
    badgeImage: 'badges/provider.svg',
    rarity: 'common',
    isActive: true,
  },
  {
    key: 'popular',
    name: 'Popular',
    description: 'Have a signal copied 100+ times.',
    criteria: { type: 'signal_copies', copies: 100 },
    badgeImage: 'badges/popular.svg',
    rarity: 'epic',
    isActive: true,
  },
  {
    key: 'diamond_hands',
    name: 'Diamond Hands',
    description: 'Hold a position for more than 30 days.',
    criteria: { type: 'position_hold_days', days: 30 },
    badgeImage: 'badges/diamond_hands.svg',
    rarity: 'legendary',
    isActive: true,
  },
  {
    key: 'profitable_month',
    name: 'Green Month',
    description: 'Close a full calendar month with net profit.',
    criteria: { type: 'profitable_month' },
    badgeImage: 'badges/profitable_month.svg',
    rarity: 'rare',
    isActive: true,
  },
];

// ─── In-memory win-streak tracker (swap with Redis in production) ─────────────

@Injectable()
export class AchievementsService implements OnModuleInit {
  private readonly logger = new Logger(AchievementsService.name);

  /** userId → current consecutive win streak */
  private winStreaks = new Map<string, number>();

  constructor(
    @InjectRepository(Achievement)
    private readonly achievementRepo: Repository<Achievement>,

    @InjectRepository(UserAchievement)
    private readonly userAchievementRepo: Repository<UserAchievement>,

    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async onModuleInit() {
    await this.seedAchievements();
  }

  private async seedAchievements() {
    for (const seed of SEED_ACHIEVEMENTS) {
      const exists = await this.achievementRepo.findOne({ where: { key: seed.key } });
      if (!exists) {
        await this.achievementRepo.save(this.achievementRepo.create(seed));
        this.logger.log(`Seeded achievement: ${seed.key}`);
      }
    }
  }

  // ─── Public query API ──────────────────────────────────────────────────────

  async getUserAchievements(userId: string): Promise<UserAchievementsResponseDto> {
    // Ensure rows exist for every active achievement
    await this.ensureProgressRows(userId);

    const rows = await this.userAchievementRepo.find({
      where: { userId },
      order: { awardedAt: 'DESC' },
    });

    const awarded = rows.filter((r) => r.isAwarded);
    const inProgress = rows.filter((r) => !r.isAwarded);

    return {
      userId,
      awarded: awarded.map(this.mapRow),
      inProgress: inProgress.map(this.mapRow),
      totalAwarded: awarded.length,
    };
  }

  async getAllAchievements() {
    return this.achievementRepo.find({ where: { isActive: true } });
  }

  // ─── Event handlers (called by the listener) ──────────────────────────────

  async handleTradeExecuted(payload: TradeExecutedPayload) {
    const { userId, profit, holdDays } = payload;

    // 1. Update win streak
    const previousStreak = this.winStreaks.get(userId) ?? 0;
    const currentStreak = profit > 0 ? previousStreak + 1 : 0;
    this.winStreaks.set(userId, currentStreak);

    // 2. Count total trades for this user
    const tradeCount = await this.getUserMetric(userId, 'trade_count');
    const newCount = tradeCount + 1;
    await this.setUserMetric(userId, 'trade_count', newCount);

    // 3. Evaluate trade-related achievements
    await this.evaluateAchievement(userId, 'first_trade', newCount, 1);
    await this.evaluateAchievement(userId, 'ten_trades', newCount, 10);
    await this.evaluateAchievement(userId, 'hot_streak', currentStreak, 5);

    // 4. Diamond Hands
    if (holdDays !== undefined) {
      await this.evaluateAchievement(userId, 'diamond_hands', holdDays, 30);
    }
  }

  async handleSignalCreated(payload: SignalCreatedPayload) {
    const { userId } = payload;
    const count = (await this.getUserMetric(userId, 'signal_count')) + 1;
    await this.setUserMetric(userId, 'signal_count', count);
    await this.evaluateAchievement(userId, 'provider', count, 1);
  }

  async handleSignalCopied(payload: SignalCopiedPayload) {
    const { providerId, totalCopies } = payload;
    await this.evaluateAchievement(providerId, 'popular', totalCopies, 100);
  }

  async handleProfitableMonth(userId: string) {
    await this.awardBadge(userId, 'profitable_month', { month: new Date().toISOString() });
  }

  // ─── Retroactive awarding ─────────────────────────────────────────────────

  /**
   * Re-evaluate all achievements for a user based on provided metrics.
   * Useful when achievements are added after some users already have history.
   */
  async retroactivelyEvaluate(
    userId: string,
    metrics: {
      tradeCount?: number;
      winStreak?: number;
      signalCount?: number;
      signalCopies?: number;
      maxHoldDays?: number;
      profitableMonth?: boolean;
    },
  ) {
    if (metrics.tradeCount !== undefined) {
      await this.setUserMetric(userId, 'trade_count', metrics.tradeCount);
      await this.evaluateAchievement(userId, 'first_trade', metrics.tradeCount, 1);
      await this.evaluateAchievement(userId, 'ten_trades', metrics.tradeCount, 10);
    }
    if (metrics.winStreak !== undefined) {
      this.winStreaks.set(userId, metrics.winStreak);
      await this.evaluateAchievement(userId, 'hot_streak', metrics.winStreak, 5);
    }
    if (metrics.signalCount !== undefined) {
      await this.setUserMetric(userId, 'signal_count', metrics.signalCount);
      await this.evaluateAchievement(userId, 'provider', metrics.signalCount, 1);
    }
    if (metrics.signalCopies !== undefined) {
      await this.evaluateAchievement(userId, 'popular', metrics.signalCopies, 100);
    }
    if (metrics.maxHoldDays !== undefined) {
      await this.evaluateAchievement(userId, 'diamond_hands', metrics.maxHoldDays, 30);
    }
    if (metrics.profitableMonth) {
      await this.awardBadge(userId, 'profitable_month', { retroactive: true });
    }
  }

  // ─── Core awarding logic ──────────────────────────────────────────────────

  /**
   * Evaluate a single achievement.
   * Updates progress row, awards badge if threshold met.
   */
  private async evaluateAchievement(
    userId: string,
    achievementKey: string,
    currentValue: number,
    threshold: number,
  ) {
    // Clamp progress at 100 once achieved
    const progress = Math.min(100, Math.round((currentValue / threshold) * 100));

    const achievement = await this.achievementRepo.findOne({
      where: { key: achievementKey, isActive: true },
    });
    if (!achievement) return;

    // Load or create progress row
    let row = await this.userAchievementRepo.findOne({
      where: { userId, achievementId: achievement.id },
    });

    if (!row) {
      row = this.userAchievementRepo.create({
        userId,
        achievementId: achievement.id,
        progress,
        awardedAt: null,
        awardedContext: null,
      });
    }

    // Already awarded – nothing to do
    if (row.awardedAt) return;

    if (currentValue >= threshold) {
      // Award!
      row.progress = null;
      row.awardedAt = new Date();
      row.awardedContext = { value: currentValue, threshold };
      await this.userAchievementRepo.save(row);

      this.logger.log(`🏅 Awarded [${achievementKey}] to user ${userId}`);

      // Emit notification event
      this.eventEmitter.emit('achievement.awarded', {
        userId,
        achievement,
        awardedAt: row.awardedAt,
      });
    } else {
      // Update progress
      row.progress = progress;
      await this.userAchievementRepo.save(row);
    }
  }

  /**
   * Directly award a badge (for criteria that can't be expressed as a simple
   * threshold, e.g. "profitable_month").
   */
  private async awardBadge(
    userId: string,
    achievementKey: string,
    context: Record<string, unknown> = {},
  ) {
    const achievement = await this.achievementRepo.findOne({
      where: { key: achievementKey, isActive: true },
    });
    if (!achievement) return;

    // Guard against duplicate awards using the unique constraint
    const existing = await this.userAchievementRepo.findOne({
      where: { userId, achievementId: achievement.id },
    });

    if (existing?.awardedAt) {
      this.logger.debug(`User ${userId} already has [${achievementKey}], skipping.`);
      return;
    }

    const row = existing ?? this.userAchievementRepo.create({ userId, achievementId: achievement.id });
    row.progress = null;
    row.awardedAt = new Date();
    row.awardedContext = context;

    try {
      await this.userAchievementRepo.save(row);
      this.logger.log(`🏅 Awarded [${achievementKey}] to user ${userId}`);
      this.eventEmitter.emit('achievement.awarded', { userId, achievement, awardedAt: row.awardedAt });
    } catch (err: any) {
      // Race condition: another request already inserted the row
      if (err.code === '23505') {
        this.logger.warn(`Duplicate award race-condition for [${achievementKey}] user ${userId}, ignoring.`);
      } else {
        throw err;
      }
    }
  }

  // ─── Metric helpers (simple persistent counter per user/key) ──────────────

  private metricKey(userId: string, metric: string) {
    return `${userId}::${metric}`;
  }

  /** Simple in-memory store – replace with Redis INCR for production */
  private metrics = new Map<string, number>();

  private async getUserMetric(userId: string, metric: string): Promise<number> {
    return this.metrics.get(this.metricKey(userId, metric)) ?? 0;
  }

  private async setUserMetric(userId: string, metric: string, value: number) {
    this.metrics.set(this.metricKey(userId, metric), value);
  }

  // ─── Ensure progress rows exist for all active achievements ──────────────

  private async ensureProgressRows(userId: string) {
    const allActive = await this.achievementRepo.find({ where: { isActive: true } });
    for (const ach of allActive) {
      const exists = await this.userAchievementRepo.findOne({
        where: { userId, achievementId: ach.id },
      });
      if (!exists) {
        await this.userAchievementRepo.save(
          this.userAchievementRepo.create({ userId, achievementId: ach.id, progress: 0 }),
        );
      }
    }
  }

  // ─── Mapping helpers ──────────────────────────────────────────────────────

  private mapRow(row: UserAchievement) {
    return {
      id: row.id,
      achievement: {
        id: row.achievement.id,
        key: row.achievement.key,
        name: row.achievement.name,
        description: row.achievement.description,
        badgeImage: row.achievement.badgeImage,
        rarity: row.achievement.rarity,
      },
      progress: row.progress,
      awardedAt: row.awardedAt ?? undefined,
      isAwarded: row.isAwarded,
    };
  }
}
