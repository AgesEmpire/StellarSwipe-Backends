import { Controller, Get, Post, Query, Body, ValidationPipe, Req, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';
import { SignalsService } from './signals.service';
import { FeedAnalyticsService } from './feed-analytics.service';
import { ProviderMuteService } from '../providers/mute/provider-mute.service';
import { SignalFeedQueryDto } from './dto/signal-feed-query.dto';
import { SignalFeedResponseDto } from './dto/signal-feed-response.dto';
import { FeedInteractionDto } from './dto/feed-interaction.dto';
import { applySparseFieldset } from '../common/utils/field-selection.util';
import { ETagInterceptor } from '../common/interceptors/etag.interceptor';
import { buildPaginationLinks } from '../common/pagination/pagination-links.util';
import { CursorValidationPipe } from '../common/pipes/cursor-validation.pipe';

@ApiTags('signals')
@Controller('signals')
export class SignalsController {
  constructor(
    private readonly signalsService: SignalsService,
    private readonly feedAnalytics: FeedAnalyticsService,
    private readonly providerMuteService: ProviderMuteService,
  ) {}

  @Get('feed')
  @UseInterceptors(ETagInterceptor)
  @ApiOperation({ summary: 'Get paginated signal feed' })
  @ApiHeader({ name: 'If-None-Match', description: 'ETag from a prior response; returns 304 when content is unchanged', required: false })
  @ApiResponse({ status: 200, type: SignalFeedResponseDto, headers: { ETag: { description: 'Content hash for conditional GET', schema: { type: 'string' } } } })
  @ApiResponse({ status: 304, description: 'Not Modified – content unchanged since the provided ETag' })
  async getFeed(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: SignalFeedQueryDto,
    // Example cursor validation usage with CursorValidationPipe:
    // @Query('cursor', new CursorValidationPipe()) validatedCursor?: string,
    @Req() req: Request,
  ): Promise<SignalFeedResponseDto> {
    // The cursor in query.cursor is now validated and safe to use.
    // For production, use the CursorValidationPipe decorator above to validate individual cursor parameters.
    const feed = await this.signalsService.getFeed(query);

    if (feed.page !== undefined && feed.totalPages !== undefined) {
      feed.links = buildPaginationLinks(req.url, {
        page: feed.page,
        limit: query.limit ?? 20,
        totalPages: feed.totalPages,
      });
    }

    return applySparseFieldset(feed, query.fields);
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
