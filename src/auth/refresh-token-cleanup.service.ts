import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { RefreshToken } from './entities/refresh-token.entity';

const DEFAULT_BATCH_SIZE = 500;

@Injectable()
export class RefreshTokenCleanupService {
  private readonly logger = new Logger(RefreshTokenCleanupService.name);
  private readonly batchSize: number;

  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly configService: ConfigService,
  ) {
    this.batchSize = this.configService.get<number>(
      'REFRESH_TOKEN_CLEANUP_BATCH_SIZE',
      DEFAULT_BATCH_SIZE,
    );
  }

  /**
   * Scheduled cleanup of expired refresh tokens.
   * Runs at 3 AM daily. Processes in batches to avoid long-running locks.
   * Safe to run concurrently across replicas — DELETE WHERE expiresAt < now is idempotent.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async deleteExpiredTokens(): Promise<void> {
    this.logger.log('Starting expired refresh token cleanup');
    const now = new Date();
    let totalDeleted = 0;

    try {
      let batchDeleted: number;
      do {
        const result = await this.refreshTokenRepository
          .createQueryBuilder()
          .delete()
          .from(RefreshToken)
          .where('expires_at < :now', { now })
          .limit(this.batchSize)
          .execute();

        batchDeleted = result.affected ?? 0;
        totalDeleted += batchDeleted;

        if (batchDeleted > 0) {
          this.logger.log(`Deleted batch of ${batchDeleted} expired refresh tokens`);
        }
      } while (batchDeleted === this.batchSize);

      this.logger.log(`Refresh token cleanup complete. Total deleted: ${totalDeleted}`);
    } catch (error) {
      this.logger.error(
        `Refresh token cleanup failed after deleting ${totalDeleted} rows`,
        (error as Error).message,
      );
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
      .where('rt.expires_at >= :now', { now: new Date() })
      .getCount();
  }
}
