import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { RefreshToken } from './entities/refresh-token.entity';
import { DistributedLockService } from '../common/services/distributed-lock.service';

const DEFAULT_BATCH_SIZE = 500;
const LOCK_KEY = 'refresh-token-cleanup';
const LOCK_TTL_MS = 10 * 60 * 1000; // 10 min — generous ceiling for large batched deletes

@Injectable()
export class RefreshTokenCleanupService {
  private readonly logger = new Logger(RefreshTokenCleanupService.name);
  private readonly batchSize: number;

  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly configService: ConfigService,
    private readonly distributedLock: DistributedLockService,
  ) {
    this.batchSize = this.configService.get<number>(
      'REFRESH_TOKEN_CLEANUP_BATCH_SIZE',
      DEFAULT_BATCH_SIZE,
    );
  }

  /**
   * Scheduled entry point. Interval is configurable via the
   * REFRESH_TOKEN_CLEANUP_CRON env var (falls back to 3 AM daily) so ops can
   * retune frequency without a code change/redeploy.
   *
   * A distributed lock ensures only one replica performs the sweep per tick.
   * The delete itself is also idempotent (WHERE expires_at < now), so even if
   * the lock is lost mid-run (e.g. TTL expiry) or skipped, concurrent
   * execution cannot double-delete or error — it simply finds fewer/no rows.
   */
  @Cron(process.env.REFRESH_TOKEN_CLEANUP_CRON ?? CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(): Promise<void> {
    const { ran } = await this.distributedLock.withLock(LOCK_KEY, LOCK_TTL_MS, () =>
      this.deleteExpiredTokens(),
    );
    if (!ran) {
      this.logger.debug('Skipping refresh token cleanup — another replica is running it');
    }
  }

  /**
   * Deletes expired refresh tokens in batches to avoid long-running locks on
   * large tables. Never touches rows whose expiry is in the future.
   *
   * Public (not private) so tests and manual/admin triggers can invoke the
   * deletion logic directly without going through the cron + lock wrapper.
   */
  async deleteExpiredTokens(): Promise<number> {
    this.logger.log('Starting expired refresh token cleanup');
    const now = new Date();
    let totalDeleted = 0;

    try {
      let fetchedCount: number;

      do {
        // TypeORM's DELETE query builder does not support LIMIT/OFFSET on all
        // drivers (notably Postgres, which this project uses), so a raw
        // `.delete().limit()` chain would throw at runtime. Instead we page
        // through expired ids with a SELECT ... LIMIT, then delete exactly
        // that batch by id. This keeps each statement small and stays
        // idempotent — a replica that loses the race simply finds nothing
        // left to select for the ids it already deleted.
        const expiredIds = await this.refreshTokenRepository
          .createQueryBuilder('rt')
          .select('rt.id', 'id')
          .where('rt.expiresAt < :now', { now })
          .orderBy('rt.expiresAt', 'ASC')
          .limit(this.batchSize)
          .getRawMany<{ id: string }>();

        fetchedCount = expiredIds.length;
        if (fetchedCount === 0) {
          break;
        }

        const result = await this.refreshTokenRepository
          .createQueryBuilder()
          .delete()
          .from(RefreshToken)
          .whereInIds(expiredIds.map((row) => row.id))
          .execute();

        const batchDeleted = result.affected ?? 0;
        totalDeleted += batchDeleted;

        if (batchDeleted > 0) {
          this.logger.log(`Deleted batch of ${batchDeleted} expired refresh tokens`);
        }
      } while (fetchedCount === this.batchSize);

      this.logger.log(`Refresh token cleanup complete. Total deleted: ${totalDeleted}`);
      return totalDeleted;
    } catch (error) {
      this.logger.error(
        `Refresh token cleanup failed after deleting ${totalDeleted} rows`,
        (error as Error).message,
      );
      return totalDeleted;
    }
  }

  /**
   * Exposed for use in integration tests and manual triggers.
   */
  async countExpired(): Promise<number> {
    return this.refreshTokenRepository.count({
      where: { expiresAt: LessThan(new Date()) },
    });
  }

  async countActive(): Promise<number> {
    return this.refreshTokenRepository
      .createQueryBuilder('rt')
      .where('rt.expiresAt >= :now', { now: new Date() })
      .getCount();
  }
}
