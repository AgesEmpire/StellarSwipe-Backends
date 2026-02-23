import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProviderFollower } from '../entities/provider-follower.entity';

export const PROVIDER_FOLLOWED_EVENT = 'provider.followed';

export interface ProviderFollowedEvent {
  userId: string;
  providerId: string;
  followedAt: Date;
}

@Injectable()
export class FollowerService {
  constructor(
    @InjectRepository(ProviderFollower)
    private readonly followerRepository: Repository<ProviderFollower>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Follow a provider.
   * Throws ConflictException if already following.
   * Throws BadRequestException on self-follow attempt.
   */
  async follow(userId: string, providerId: string): Promise<ProviderFollower> {
    if (userId === providerId) {
      throw new BadRequestException('Users cannot follow themselves.');
    }

    // Verify provider exists (assumes a providers table with an id column)
    const providerExists = await this.dataSource.query(
      `SELECT id FROM providers WHERE id = $1 LIMIT 1`,
      [providerId],
    );
    if (!providerExists.length) {
      throw new NotFoundException(`Provider ${providerId} not found.`);
    }

    const existing = await this.followerRepository.findOne({
      where: { userId, providerId },
    });
    if (existing) {
      throw new ConflictException('You are already following this provider.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const follower = this.followerRepository.create({ userId, providerId });
      const saved = await queryRunner.manager.save(ProviderFollower, follower);

      // Increment follower_count on the provider
      await queryRunner.manager.query(
        `UPDATE providers SET follower_count = follower_count + 1 WHERE id = $1`,
        [providerId],
      );

      await queryRunner.commitTransaction();

      // Emit follow event for notifications
      const event: ProviderFollowedEvent = {
        userId,
        providerId,
        followedAt: saved.followedAt,
      };
      this.eventEmitter.emit(PROVIDER_FOLLOWED_EVENT, event);

      return saved;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Unfollow a provider.
   * Throws NotFoundException if not currently following.
   */
  async unfollow(userId: string, providerId: string): Promise<void> {
    const existing = await this.followerRepository.findOne({
      where: { userId, providerId },
    });
    if (!existing) {
      throw new NotFoundException('You are not following this provider.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.remove(ProviderFollower, existing);

      // Decrement follower_count, never below 0
      await queryRunner.manager.query(
        `UPDATE providers SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = $1`,
        [providerId],
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Returns provider IDs that the given user follows.
   */
  async getFollowedProviderIds(userId: string): Promise<string[]> {
    const rows = await this.followerRepository.find({
      where: { userId },
      select: ['providerId'],
    });
    return rows.map((r) => r.providerId);
  }

  /**
   * Returns the follower count for a provider.
   */
  async getFollowerCount(providerId: string): Promise<number> {
    return this.followerRepository.count({ where: { providerId } });
  }

  /**
   * Returns whether a specific user follows a provider.
   */
  async isFollowing(userId: string, providerId: string): Promise<boolean> {
    const count = await this.followerRepository.count({
      where: { userId, providerId },
    });
    return count > 0;
  }
}
