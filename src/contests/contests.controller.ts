import { Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus, Sse, MessageEvent } from '@nestjs/common';
import { Observable, interval, switchMap, map } from 'rxjs';
import { ContestsService } from './contests.service';
import { CreateContestDto, ContestQueryDto } from './dto/contest.dto';
import { Contest, ContestStatus } from './entities/contest.entity';
import { SocketManagerService } from '../websocket/services/socket-manager.service';

@Controller('contests')
export class ContestsController {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly socketManager: SocketManagerService,
  ) {}

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

  /**
   * SSE endpoint for real-time leaderboard updates.
   * Clients connect once and receive pushed updates every 10 seconds.
   * Falls back to polling via GET :id/leaderboard for clients that don't support SSE.
   */
  @Sse(':id/leaderboard/live')
  liveLeaderboard(@Param('id') id: string): Observable<MessageEvent> {
    return interval(10_000).pipe(
      switchMap(() => this.contestsService.getContestLeaderboard(id)),
      map((data) => ({ data: JSON.stringify(data) } as MessageEvent)),
    );
  }

  @Post(':id/leaderboard/refresh')
  @HttpCode(HttpStatus.OK)
  async refreshLeaderboard(@Param('id') id: string) {
    const leaderboard = await this.contestsService.getContestLeaderboard(id);
    // Push update to all WebSocket subscribers of this contest room
    this.socketManager.emitContestLeaderboard(id, leaderboard);
    return leaderboard;
  }

  @Post(':id/finalize')
  @HttpCode(HttpStatus.OK)
  async finalizeContest(@Param('id') id: string) {
    const result = await this.contestsService.finalizeContest(id);
    // Notify WebSocket subscribers that contest is finalized
    this.socketManager.emitContestLeaderboard(id, { ...result, status: 'FINALIZED' });
    return result;
  }
}
