import { Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ContestsService } from './contests.service';
import { CreateContestDto, ContestQueryDto } from './dto/contest.dto';
import { Contest, ContestStatus } from './entities/contest.entity';

@Controller('contests')
export class ContestsController {
  constructor(private readonly contestsService: ContestsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createContest(@Body() dto: CreateContestDto): Promise<Contest> {
    return this.contestsService.createContest(dto);
  }

  @Get()
  async getContests(@Query() query: ContestQueryDto): Promise<Contest[]> {
    const status = query.status as ContestStatus | undefined;
    const limit = query.limit || 50;
    return this.contestsService.getAllContests(status, limit);
  }

  @Get('active')
  async getActiveContests(): Promise<Contest[]> {
    return this.contestsService.getActiveContests();
  }

  @Get(':id')
  async getContest(@Param('id') id: string): Promise<Contest> {
    return this.contestsService.getContest(id);
  }

  @Get(':id/leaderboard')
  async getLeaderboard(@Param('id') id: string) {
    return this.contestsService.getContestLeaderboard(id);
  }

  @Post(':id/finalize')
  @HttpCode(HttpStatus.OK)
  async finalizeContest(@Param('id') id: string) {
    return this.contestsService.finalizeContest(id);
  }
}
