import { Controller, Get, Post, Query, Body, ValidationPipe, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { SignalsService } from './signals.service';
import { FeedAnalyticsService } from './feed-analytics.service';
import { SignalFeedQueryDto } from './dto/signal-feed-query.dto';
import { SignalFeedResponseDto } from './dto/signal-feed-response.dto';
import { FeedInteractionDto } from './dto/feed-interaction.dto';

@ApiTags('signals')
@Controller('signals')
export class SignalsController {
  constructor(
    private readonly signalsService: SignalsService,
    private readonly feedAnalytics: FeedAnalyticsService,
  ) {}

  @Get('feed')
  @ApiOperation({ summary: 'Get paginated signal feed' })
  @ApiResponse({ status: 200, type: SignalFeedResponseDto })
  async getFeed(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: SignalFeedQueryDto,
  ): Promise<SignalFeedResponseDto> {
    return this.signalsService.getFeed(query);
  }

  @Post('interactions')
  @ApiOperation({ summary: 'Track a feed interaction event' })
  @ApiResponse({ status: 201, description: 'Event tracked' })
  async trackInteraction(
    @Body(new ValidationPipe({ transform: true, whitelist: true })) dto: FeedInteractionDto,
    @Req() req: Request,
  ): Promise<{ status: string }> {
    const userId: string | undefined = (req as any).user?.id;
    const sessionId: string | undefined = (req as any).user?.sessionId;
    return this.feedAnalytics.track(dto, userId, sessionId);
  }
}
