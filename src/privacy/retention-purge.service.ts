import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RetentionPurgeService {
  private readonly logger = new Logger(RetentionPurgeService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDailyPurge(): Promise<void> {
    this.logger.log('Starting retention purge job');
    try {
      const days = this.config.get<number>('retention.deletedUserDays') ?? 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      const users = await this.userRepo.find({ where: { deletedAt: MoreThan(0) } });
      // Filter manually to compare deletedAt
      const eligible = users.filter((u) => u.deletedAt && u.deletedAt < cutoff);

      let purged = 0;
      for (const user of eligible) {
        // Anonymize PII fields but keep row for aggregates
        user.email = null;
        user.displayName = null;
        user.bio = null;
        await this.userRepo.save(user);
        purged += 1;
      }

      this.logger.log(`Retention purge completed. Records purged: ${purged}`);
    } catch (error) {
      this.logger.error('Retention purge failed', error);
    }
  }

  // Exposed for tests / manual run
  async purgeNowForTesting(daysThreshold = this.config.get<number>('retention.deletedUserDays') ?? 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysThreshold);
    const users = await this.userRepo.find();
    const eligible = users.filter((u) => u.deletedAt && u.deletedAt < cutoff);
    for (const user of eligible) {
      user.email = null;
      user.displayName = null;
      user.bio = null;
      await this.userRepo.save(user);
    }
    return eligible.length;
  }
}
