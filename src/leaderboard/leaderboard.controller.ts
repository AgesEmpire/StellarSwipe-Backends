import { Controller, Get, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { LeaderboardService, LeaderboardResponse } from './leaderboard.service';
import { LeaderboardQueryDto } from './dto/leaderboard-query.dto';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get('providers')
  @HttpCode(HttpStatus.OK)
  async getProviderLeaderboard(
    @Query() query: LeaderboardQueryDto,
  ): Promise<LeaderboardResponse> {
    return this.leaderboardService.getLeaderboard(query);
  }
}
