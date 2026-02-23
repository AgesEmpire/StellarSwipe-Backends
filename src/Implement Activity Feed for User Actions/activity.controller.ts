import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ActivityService } from './activity.service';
import { ActivityFeedQueryDto, ActivityFeedResponseDto } from './dto/activity-feed.dto';
// Replace with your actual auth guard
// import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Activity')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard)
@Controller('activity')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get('feed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get paginated activity feed for the authenticated user' })
  @ApiQuery({ name: 'type', required: false, example: 'TRADE_EXECUTED,SWIPE_RIGHT' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  async getFeed(
    @Query() query: ActivityFeedQueryDto,
    @Req() req: any,
  ): Promise<ActivityFeedResponseDto> {
    // req.user.id comes from your JWT auth guard
    const userId: string = req.user?.id ?? 'demo-user';
    return this.activityService.getFeed(userId, query);
  }
}
