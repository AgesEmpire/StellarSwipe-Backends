/**
 * LeaderboardRepository
 *
 * Encapsulates all leaderboard aggregation queries with optimised index hints.
 *
 * Recommended PostgreSQL indexes (add via migration):
 *   CREATE INDEX CONCURRENTLY idx_signals_leaderboard
 *     ON signals (provider_address, status, created_at)
 *     WHERE status = 'closed';
 *
 *   CREATE INDEX CONCURRENTLY idx_signals_pnl_outcome
 *     ON signals (provider_address, outcome, pnl)
 *     WHERE status = 'closed';
 *
 *   CREATE INDEX CONCURRENTLY idx_providers_address
 *     ON providers (address)
 *     INCLUDE (name, avatar, bio);
 *
 * These partial/covering indexes eliminate full-table scans on the hot
 * aggregation path and allow index-only scans for provider metadata lookups.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Signal } from '../signals/signal.entity';
import { Provider } from '../providers/provider.entity';
import { LeaderboardPeriod } from './dto/leaderboard-query.dto';
import { LeaderboardEntry } from './leaderboard.service';

interface RawLeaderboardRow {
  provider: string;
  signalCount: string;
  winRate: string;
  totalPnL: string;
}

@Injectable()
export class LeaderboardRepository {
  private readonly logger = new Logger(LeaderboardRepository.name);

  constructor(
    @InjectRepository(Signal)
    private readonly signalRepo: Repository<Signal>,

    @InjectRepository(Provider)
    private readonly providerRepo: Repository<Provider>,

    private readonly dataSource: DataSource,
  ) {}

  /**
   * Aggregate leaderboard rows for the given period.
   *
   * Uses a single GROUP BY query that leverages the partial index on
   * (provider_address, status, created_at) to avoid sequential scans.
   * Provider metadata is fetched in one IN-query (no N+1).
   */
  async aggregateLeaderboard(
    period: LeaderboardPeriod,
    limit: number,
  ): Promise<LeaderboardEntry[]> {
    const dateFilter = this.resolveDateFilter(period);

    const qb = this.signalRepo
      .createQueryBuilder('s')
      // Only columns needed — avoids SELECT * overhead
      .select('s.provider_address', 'provider')
      .addSelect('COUNT(s.id)', 'signalCount')
      .addSelect(
        `ROUND(
           (SUM(CASE WHEN s.outcome = 'win' THEN 1 ELSE 0 END)::numeric
            / NULLIF(COUNT(s.id), 0)) * 100,
           2
         )`,
        'winRate',
      )
      .addSelect('COALESCE(ROUND(SUM(s.pnl)::numeric, 2), 0)', 'totalPnL')
      // Partial index hint: filter matches the WHERE clause of the index
      .where('s.status = :status', { status: 'closed' })
      .groupBy('s.provider_address')
      // Composite score — mirrors computeScore() in the service
      .orderBy(
        `(
           (SUM(CASE WHEN s.outcome = 'win' THEN 1 ELSE 0 END)::numeric
            / NULLIF(COUNT(s.id), 0)) * 100 * 0.5
           + COALESCE(SUM(s.pnl), 0) * 0.3
           + COUNT(s.id) * 0.2
         )`,
        'DESC',
      )
      .limit(limit);

    if (dateFilter) {
      // Uses the created_at column covered by the partial index
      qb.andWhere('s.created_at >= :from', { from: dateFilter });
    }

    const rows: RawLeaderboardRow[] = await qb.getRawMany();

    if (!rows.length) return [];

    const metaMap = await this.fetchProviderMetadata(rows.map((r) => r.provider));

    return rows.map((row, idx) => {
      const winRate = parseFloat(row.winRate) || 0;
      const totalPnL = parseFloat(row.totalPnL) || 0;
      const signalCount = parseInt(row.signalCount, 10) || 0;
      const meta = metaMap.get(row.provider);

      return {
        rank: idx + 1,
        provider: row.provider,
        name: meta?.name ?? null,
        avatar: meta?.avatar ?? null,
        bio: meta?.bio ?? null,
        winRate,
        totalPnL,
        signalCount,
        score: Math.round((winRate * 0.5 + totalPnL * 0.3 + signalCount * 0.2) * 100) / 100,
      };
    });
  }

  /**
   * Fetch provider metadata in a single covering-index scan.
   * The INCLUDE (name, avatar, bio) index makes this an index-only read.
   */
  async fetchProviderMetadata(
    addresses: string[],
  ): Promise<Map<string, { name: string; avatar: string; bio: string }>> {
    if (!addresses.length) return new Map();

    const providers = await this.providerRepo
      .createQueryBuilder('p')
      .select(['p.address', 'p.name', 'p.avatar', 'p.bio'])
      .where('p.address IN (:...addresses)', { addresses })
      .getMany();

    return new Map(
      providers.map((p) => [p.address, { name: p.name, avatar: p.avatar, bio: p.bio }]),
    );
  }

  /**
   * Emit the recommended DDL for leaderboard indexes.
   * Call this from a migration or a one-time admin endpoint.
   */
  async ensureIndexes(): Promise<void> {
    const statements = [
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_leaderboard
         ON signals (provider_address, status, created_at)
         WHERE status = 'closed'`,

      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_pnl_outcome
         ON signals (provider_address, outcome, pnl)
         WHERE status = 'closed'`,

      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_providers_address
         ON providers (address)
         INCLUDE (name, avatar, bio)`,
    ];

    for (const sql of statements) {
      try {
        await this.dataSource.query(sql);
        this.logger.log(`Index ensured: ${sql.split('\n')[0].trim()}`);
      } catch (err) {
        // CONCURRENTLY cannot run inside a transaction; log and continue
        this.logger.warn(`Index creation skipped (may already exist): ${(err as Error).message}`);
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

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
      default:
        return null;
    }
  }
}
