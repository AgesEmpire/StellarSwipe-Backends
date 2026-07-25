import { Controller, Get, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RateLimit, RateLimitTier } from '../common/decorators/rate-limit.decorator';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardResponse } from './leaderboard.types';
import { LeaderboardQueryDto } from './dto/leaderboard-query.dto';

@ApiTags('leaderboard')
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get('providers')
  @RateLimit({ tier: RateLimitTier.PUBLIC, limit: 30, window: 60 })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get top-performing signal providers ranked by ROI' })
  @ApiResponse({ status: 200, description: 'Paginated provider leaderboard' })
  async getProviderLeaderboard(
    @Query() query: LeaderboardQueryDto,
  ): Promise<LeaderboardResponse> {
    return this.leaderboardService.getProviderLeaderboard(query);
  }

  @Get('users')
  @RateLimit({ tier: RateLimitTier.PUBLIC, limit: 30, window: 60 })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get top-performing copy-traders ranked by ROI' })
  @ApiResponse({ status: 200, description: 'Paginated user leaderboard' })
  async getUserLeaderboard(
    @Query() query: LeaderboardQueryDto,
  ): Promise<LeaderboardResponse> {
    return this.leaderboardService.getUserLeaderboard(query);
  }
}
