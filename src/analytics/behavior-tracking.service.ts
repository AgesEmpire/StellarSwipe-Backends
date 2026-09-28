import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSessionAnalytics } from './entities/user-session.entity';
import { UserEvent, UserEventType } from './entities/user-event.entity';
import { AnalyticsService } from './analytics.service';

export interface SessionMetrics {
  totalSessions: number;
  avgDurationSeconds: number;
  avgEventsPerSession: number;
  bounceRate: number; // sessions with only 1 event
}

@Injectable()
export class BehaviorTrackingService {
  private readonly logger = new Logger(BehaviorTrackingService.name);

  constructor(
    @InjectRepository(UserSessionAnalytics)
    private readonly sessionRepo: Repository<UserSessionAnalytics>,
    @InjectRepository(UserEvent)
    private readonly eventRepo: Repository<UserEvent>,
    private readonly analyticsService: AnalyticsService,
  ) {}

  async startSession(
    sessionId: string,
    userId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<UserSessionAnalytics> {
    const existing = await this.sessionRepo.findOne({ where: { sessionId } });
    if (existing) return existing;

    const session = this.sessionRepo.create({
      sessionId,
      userId,
      startedAt: new Date(),
      eventCount: 0,
      metadata,
    });
    return this.sessionRepo.save(session);
  }

  async endSession(sessionId: string): Promise<UserSessionAnalytics | null> {
    const session = await this.sessionRepo.findOne({ where: { sessionId } });
    if (!session || session.endedAt) return session ?? null;

    const endedAt = new Date();
    const durationSeconds = Math.floor(
      (endedAt.getTime() - session.startedAt.getTime()) / 1000,
    );

    // Count events for this session
    const eventCount = await this.eventRepo.count({ where: { sessionId } });

    session.endedAt = endedAt;
    session.durationSeconds = durationSeconds;
    session.eventCount = eventCount;

    return this.sessionRepo.save(session);
  }

  async trackEvent(
    eventType: UserEventType,
    occurredAt: Date,
    userId?: string,
    sessionId?: string,
    eventId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ status: 'tracked' | 'duplicate' }> {
    const result = await this.analyticsService.trackEvent({
      eventType,
      occurredAt,
      userId,
      sessionId,
      eventId,
      metadata,
    });

    // Increment session event count if session exists
    if (sessionId && result.status === 'tracked') {
      await this.sessionRepo
        .createQueryBuilder()
        .update(UserSessionAnalytics)
        .set({ eventCount: () => 'event_count + 1' })
        .where('session_id = :sessionId', { sessionId })
        .execute();
    }

    return result;
  }

  async getSessionMetrics(
    startDate: Date,
    endDate: Date,
    userId?: string,
  ): Promise<SessionMetrics> {
    const qb = this.sessionRepo
      .createQueryBuilder('s')
      .where('s.started_at BETWEEN :start AND :end', {
        start: startDate,
        end: endDate,
      })
      .andWhere('s.ended_at IS NOT NULL');

    if (userId) {
      qb.andWhere('s.user_id = :userId', { userId });
    }

    const sessions = await qb.getMany();

    if (sessions.length === 0) {
      return { totalSessions: 0, avgDurationSeconds: 0, avgEventsPerSession: 0, bounceRate: 0 };
    }

    const totalDuration = sessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
    const totalEvents = sessions.reduce((sum, s) => sum + s.eventCount, 0);
    const bounceSessions = sessions.filter((s) => s.eventCount <= 1).length;

    return {
      totalSessions: sessions.length,
      avgDurationSeconds: Math.round(totalDuration / sessions.length),
      avgEventsPerSession: parseFloat((totalEvents / sessions.length).toFixed(2)),
      bounceRate: parseFloat(((bounceSessions / sessions.length) * 100).toFixed(2)),
    };
  }

  async getUserBehaviorSummary(
    userId: string,
    days = 30,
  ): Promise<{
    sessionMetrics: SessionMetrics;
    eventBreakdown: Record<string, number>;
    mostActiveHour: number | null;
  }> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    const sessionMetrics = await this.getSessionMetrics(startDate, endDate, userId);

    // Event breakdown by type
    const events = await this.eventRepo
      .createQueryBuilder('e')
      .select('e.event_type', 'eventType')
      .addSelect('COUNT(*)', 'count')
      .where('e.user_id = :userId', { userId })
      .andWhere('e.occurred_at BETWEEN :start AND :end', { start: startDate, end: endDate })
      .groupBy('e.event_type')
      .getRawMany();

    const eventBreakdown: Record<string, number> = {};
    for (const row of events) {
      eventBreakdown[row.eventType] = parseInt(row.count, 10);
    }

    // Most active hour
    const hourRow = await this.eventRepo
      .createQueryBuilder('e')
      .select('EXTRACT(HOUR FROM e.occurred_at)::int', 'hour')
      .addSelect('COUNT(*)', 'count')
      .where('e.user_id = :userId', { userId })
      .andWhere('e.occurred_at BETWEEN :start AND :end', { start: startDate, end: endDate })
      .groupBy('hour')
      .orderBy('count', 'DESC')
      .limit(1)
      .getRawOne();

    return {
      sessionMetrics,
      eventBreakdown,
      mostActiveHour: hourRow ? hourRow.hour : null,
    };
  }
}
