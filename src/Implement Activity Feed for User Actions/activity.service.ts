import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Activity, ActivityType } from './entities/activity.entity';
import {
  ActivityFeedQueryDto,
  ActivityFeedResponseDto,
  ActivityResponseDto,
  LogActivityDto,
} from './dto/activity-feed.dto';
import { ActivityGateway } from './activity.gateway';

// Rate-limiting: max activities per user per type per window
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10;

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);
  // In-memory rate limit tracker: key = `${userId}:${type}`, value = { count, windowStart }
  private readonly rateLimitMap = new Map<string, { count: number; windowStart: number }>();

  constructor(
    @InjectRepository(Activity)
    private readonly activityRepo: Repository<Activity>,
    private readonly activityGateway: ActivityGateway,
  ) {}

  /**
   * Log a new activity. Returns null if rate-limited.
   */
  async log(dto: LogActivityDto): Promise<Activity | null> {
    if (this.isRateLimited(dto.userId, dto.type)) {
      this.logger.warn(`Rate limited: userId=${dto.userId} type=${dto.type}`);
      return null;
    }

    const activity = this.activityRepo.create({
      userId: dto.userId,
      type: dto.type,
      metadata: dto.metadata ?? {},
    });

    const saved = await this.activityRepo.save(activity);

    // Emit real-time update
    const response = this.toResponse(saved);
    this.activityGateway.emitToUser(dto.userId, response);

    return saved;
  }

  async getFeed(
    userId: string,
    query: ActivityFeedQueryDto,
  ): Promise<ActivityFeedResponseDto> {
    const { type, page = 1, limit = 20 } = query;

    // Cap total returned to 100
    const effectiveLimit = Math.min(limit, 100);
    const effectivePage = Math.max(page, 1);
    const skip = (effectivePage - 1) * effectiveLimit;

    const where: any = { userId };
    if (type && type.length > 0) {
      where.type = In(type);
    }

    const [activities, total] = await this.activityRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: Math.min(effectiveLimit, 100 - skip < 0 ? 0 : 100 - skip),
      skip,
    });

    return {
      data: activities.map(this.toResponse),
      total: Math.min(total, 100),
      page: effectivePage,
      limit: effectiveLimit,
      hasMore: skip + activities.length < Math.min(total, 100),
    };
  }

  private toResponse(activity: Activity): ActivityResponseDto {
    return {
      id: activity.id,
      userId: activity.userId,
      type: activity.type,
      metadata: activity.metadata,
      createdAt: activity.createdAt,
      description: ActivityService.buildDescription(activity.type, activity.metadata),
    };
  }

  static buildDescription(type: ActivityType, metadata: Record<string, any>): string {
    switch (type) {
      case ActivityType.TRADE_EXECUTED:
        return `Bought ${metadata.amount ?? ''} ${metadata.pair ?? ''} at $${metadata.price ?? ''}`;
      case ActivityType.SIGNAL_FOLLOWED:
      case ActivityType.FOLLOW_SIGNAL:
        return `Started following signal "${metadata.signalName ?? ''}" #${metadata.signalId ?? ''}`;
      case ActivityType.SWIPE_RIGHT:
        return `Swiped right on ${metadata.asset ?? ''} signal`;
      case ActivityType.SWIPE_LEFT:
        return `Swiped left on ${metadata.asset ?? ''} signal`;
      case ActivityType.UPDATE_SETTINGS:
        return `Updated settings: ${metadata.field ?? 'profile'}`;
      default:
        return type;
    }
  }

  private isRateLimited(userId: string, type: ActivityType): boolean {
    const key = `${userId}:${type}`;
    const now = Date.now();
    const record = this.rateLimitMap.get(key);

    if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
      this.rateLimitMap.set(key, { count: 1, windowStart: now });
      return false;
    }

    if (record.count >= RATE_LIMIT_MAX) {
      return true;
    }

    record.count += 1;
    return false;
  }

  /**
   * Archive activities older than 90 days — runs daily at 2 AM.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async archiveOldActivities(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const result = await this.activityRepo.delete({ createdAt: LessThan(cutoff) });
    this.logger.log(`Archived ${result.affected ?? 0} old activities`);
  }
}
