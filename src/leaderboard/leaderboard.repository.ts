/**
 * LeaderboardRepository
 *
 * Encapsulates all leaderboard aggregation queries with optimised index hints.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  Signal,
  SignalStatus,
  SignalOutcome,
} from '../signals/entities/signal.entity';
import {
  CopiedPosition,
  PositionStatus,
} from '../signals/entities/copied-position.entity';
import { User } from '../users/entities/user.entity';
import { LeaderboardPeriod } from './dto/leaderboard-query.dto';
import {
  ProviderLeaderboardEntry,
  UserLeaderboardEntry,
} from './leaderboard.types';

interface RawProviderLeaderboardRow {
  providerId: string;
  signalCount: string;
  winRate: string;
  totalPnl: string;
}

interface RawUserLeaderboardRow {
  userId: string;
  adoptionCount: string;
  successRate: string;
  averageReturn: string;
  totalReturn: string;
}

@Injectable()
export class LeaderboardRepository {
  private readonly logger = new Logger(LeaderboardRepository.name);

  constructor(
    @InjectRepository(Signal)
    private readonly signalRepo: Repository<Signal>,

    @InjectRepository(CopiedPosition)
    private readonly copiedPositionRepo: Repository<CopiedPosition>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly dataSource: DataSource,
  ) {}

  async aggregateProviderLeaderboard(
    period: LeaderboardPeriod,
    limit: number,
    page: number = 1,
    minActivity: number = 3,
  ): Promise<ProviderLeaderboardEntry[]> {
    const dateFilter = this.resolveDateFilter(period);
    const offset = (page - 1) * limit;

    const qb = this.signalRepo
      .createQueryBuilder('s')
      .select('s.providerId', 'providerId')
      .addSelect('COUNT(s.id)', 'signalCount')
      .addSelect(
        `ROUND(
           (SUM(CASE WHEN s.outcome = :success THEN 1 ELSE 0 END)::numeric
            / NULLIF(COUNT(s.id), 0)) * 100,
           2
         )`,
        'winRate',
      )
      .addSelect('COALESCE(ROUND(SUM(s.totalProfitLoss)::numeric, 2), 0)', 'totalPnl')
      .where('s.status = :status', { status: SignalStatus.CLOSED })
      .groupBy('s.providerId')
      .having('COUNT(s.id) >= :minActivity', { minActivity })
      .orderBy(
        `(
           (SUM(CASE WHEN s.outcome = :success THEN 1 ELSE 0 END)::numeric
            / NULLIF(COUNT(s.id), 0)) * 100 * 0.5
           + COALESCE(SUM(s.totalProfitLoss::numeric), 0) * 0.3
           + COUNT(s.id) * 0.2
         )`,
        'DESC',
      )
      .limit(limit)
      .offset(offset)
      .setParameters({ success: SignalOutcome.TARGET_HIT });

    if (dateFilter) {
      qb.andWhere('s.createdAt >= :from', { from: dateFilter });
    }

    const rows: RawProviderLeaderboardRow[] = await qb.getRawMany();
    if (!rows.length) return [];

    const metadata = await this.fetchUserMetadata(rows.map((row) => row.providerId));

    return rows.map((row, index) => {
      const winRate = parseFloat(row.winRate) || 0;
      const totalPnl = parseFloat(row.totalPnl) || 0;
      const signalCount = parseInt(row.signalCount, 10) || 0;
      const score = Math.round(
        (winRate * 0.5 + totalPnl * 0.3 + signalCount * 0.2) * 100,
      ) / 100;
      const meta = metadata.get(row.providerId);

      return {
        rank: index + 1,
        providerId: row.providerId,
        username: meta?.username ?? null,
        displayName: meta?.displayName ?? null,
        avatar: meta?.avatar ?? null,
        bio: meta?.bio ?? null,
        winRate,
        totalPnl,
        signalCount,
        score,
      };
    });
  }

  async aggregateUserLeaderboard(
    period: LeaderboardPeriod,
    limit: number,
    page: number = 1,
    minActivity: number = 3,
  ): Promise<UserLeaderboardEntry[]> {
    const dateFilter = this.resolveDateFilter(period);
    const offset = (page - 1) * limit;

    const qb = this.copiedPositionRepo
      .createQueryBuilder('p')
      .select('p.userId', 'userId')
      .addSelect('COUNT(p.id)', 'adoptionCount')
      .addSelect(
        `ROUND(
           COALESCE(
             SUM(CASE WHEN COALESCE(p.pnlPercentage::numeric, 0) > 0 THEN 1 ELSE 0 END)::numeric
             / NULLIF(COUNT(p.id), 0) * 100,
             0
           ),
           2
         )`,
        'successRate',
      )
      .addSelect(
        `ROUND(COALESCE(AVG(COALESCE(p.pnlPercentage::numeric, 0)), 0), 2)`,
        'averageReturn',
      )
      .addSelect(
        `ROUND(COALESCE(SUM(COALESCE(p.pnlPercentage::numeric, 0)), 0), 2)`,
        'totalReturn',
      )
      .where('p.status = :status', { status: PositionStatus.CLOSED })
      .groupBy('p.userId')
      .having('COUNT(p.id) >= :minActivity', { minActivity })
      .orderBy(
        `(
           COALESCE(AVG(COALESCE(p.pnlPercentage::numeric, 0)), 0) * 0.4
           + COALESCE(SUM(COALESCE(p.pnlPercentage::numeric, 0)), 0) * 0.2
           + COUNT(p.id) * 0.2
           + COALESCE(
               SUM(CASE WHEN COALESCE(p.pnlPercentage::numeric, 0) > 0 THEN 1 ELSE 0 END)::numeric
               / NULLIF(COUNT(p.id), 0) * 100,
               0
             ) * 0.2
         )`,
        'DESC',
      )
      .limit(limit)
      .offset(offset);

    if (dateFilter) {
      qb.andWhere('p.createdAt >= :from', { from: dateFilter });
    }

    const rows: RawUserLeaderboardRow[] = await qb.getRawMany();
    if (!rows.length) return [];

    const metadata = await this.fetchUserMetadata(rows.map((row) => row.userId));

    return rows.map((row, index) => {
      const adoptionCount = parseInt(row.adoptionCount, 10) || 0;
      const successRate = parseFloat(row.successRate) || 0;
      const averageReturn = parseFloat(row.averageReturn) || 0;
      const totalReturn = parseFloat(row.totalReturn) || 0;
      const score = Math.round(
        (averageReturn * 0.4 + totalReturn * 0.2 + adoptionCount * 0.2 + successRate * 0.2) * 100,
      ) / 100;
      const meta = metadata.get(row.userId);

      return {
        rank: index + 1,
        userId: row.userId,
        username: meta?.username ?? null,
        displayName: meta?.displayName ?? null,
        totalReturn,
        averageReturn,
        adoptionCount,
        successRate,
        score,
      };
    });
  }

  async fetchUserMetadata(
    ids: string[],
  ): Promise<
    Map<
      string,
      { username: string; displayName: string | null; avatar: string | null; bio: string | null }
    >
  > {
    if (!ids.length) return new Map();

    const users = await this.userRepo
      .createQueryBuilder('u')
      .select(['u.id', 'u.username', 'u.displayName', 'u.bio'])
      .where('u.id IN (:...ids)', { ids })
      .getMany();

    return new Map(
      users.map((user) => [
        user.id,
        {
          username: user.username,
          displayName: user.displayName ?? null,
          avatar: null,
          bio: user.bio ?? null,
        },
      ]),
    );
  }

  async ensureIndexes(): Promise<void> {
    const statements = [
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_leaderboard
         ON signals (provider_id, status, created_at)
         WHERE status = 'CLOSED'`,
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_pnl_outcome
         ON signals (provider_id, outcome, total_profit_loss)
         WHERE status = 'CLOSED'`,
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_copied_positions_leaderboard
         ON copied_positions (user_id, status, created_at)
         WHERE status = 'CLOSED'`,
    ];

    for (const sql of statements) {
      try {
        await this.dataSource.query(sql);
        this.logger.log(`Index ensured: ${sql.split('\n')[0].trim()}`);
      } catch (err) {
        this.logger.warn(
          `Index creation skipped (may already exist): ${(err as Error).message}`,
        );
      }
    }
  }

  private resolveDateFilter(period: LeaderboardPeriod): Date | null {
    const now = new Date();
    switch (period) {
      case LeaderboardPeriod.DAILY: {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        return d;
      }
      case LeaderboardPeriod.WEEKLY: {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        d.setHours(0, 0, 0, 0);
        return d;
      }
      case LeaderboardPeriod.MONTHLY: {
        const d = new Date(now);
        d.setDate(d.getDate() - 30);
        d.setHours(0, 0, 0, 0);
        return d;
      }
      default:
        return null;
    }
  }
}
