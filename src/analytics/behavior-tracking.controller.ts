import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { BehaviorTrackingService } from './behavior-tracking.service';
import {
  EndSessionDto,
  StartSessionDto,
  TrackBehaviorEventDto,
  UpdateTrackingConsentDto,
} from './dto/behavior-tracking.dto';
import { UserEventType } from './entities/user-event.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserPreference } from '../users/entities/user-preference.entity';

@Controller('analytics/behavior')
export class BehaviorTrackingController {
  constructor(
    private readonly behaviorService: BehaviorTrackingService,
    @InjectRepository(UserPreference)
    private readonly preferenceRepo: Repository<UserPreference>,
  ) {}

  @Post('events')
  async trackEvent(@Body() dto: TrackBehaviorEventDto, @Req() req: any) {
    const userId = req.user?.id ?? dto.userId;

    // Enforce opt-in: if userId present, check consent
    if (userId) {
      const pref = await this.preferenceRepo.findOne({ where: { userId } });
      if (pref && pref.analyticsOptIn === false) {
        return { status: 'skipped', reason: 'user_opted_out' };
      }
    }

    const occurredAt = new Date(dto.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BadRequestException('occurredAt must be a valid ISO date');
    }

    return this.behaviorService.trackEvent(
      dto.eventType as UserEventType,
      occurredAt,
      userId,
      dto.sessionId,
      dto.eventId,
      dto.metadata,
    );
  }

  @Post('sessions/start')
  async startSession(@Body() dto: StartSessionDto, @Req() req: any) {
    const userId = req.user?.id ?? dto.userId;
    return this.behaviorService.startSession(dto.sessionId, userId, dto.metadata);
  }

  @Post('sessions/end')
  async endSession(@Body() dto: EndSessionDto) {
    return this.behaviorService.endSession(dto.sessionId);
  }

  @Get('sessions/metrics')
  async getSessionMetrics(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('userId') userId?: string,
  ) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('startDate and endDate must be valid ISO dates');
    }
    return this.behaviorService.getSessionMetrics(start, end, userId);
  }

  @Get('users/:userId/summary')
  async getUserSummary(
    @Param('userId') userId: string,
    @Query('days') days?: string,
  ) {
    return this.behaviorService.getUserBehaviorSummary(userId, days ? parseInt(days, 10) : 30);
  }

  @Patch('consent')
  async updateConsent(@Body() dto: UpdateTrackingConsentDto, @Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authentication required');

    await this.preferenceRepo.update({ userId }, { analyticsOptIn: dto.analyticsOptIn });
    return { analyticsOptIn: dto.analyticsOptIn };
  }
}
