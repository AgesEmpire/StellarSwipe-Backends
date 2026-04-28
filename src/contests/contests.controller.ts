import { Controller, Get, Post, Put, Body, Param, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ContestsService } from './contests.service';
import { CreateContestDto, ContestQueryDto, UpdateContestDto } from './dto/contest.dto';
import { Contest, ContestStatus } from './entities/contest.entity';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('contests')
@Controller('contests')
@ApiBearerAuth()
export class ContestsController {
  constructor(private readonly contestsService: ContestsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('contests:admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new contest (Admin only)' })
  @ApiResponse({ status: 201, description: 'Contest created' })
  async createContest(@Body() dto: CreateContestDto): Promise<Contest> {
    return this.contestsService.createContest(dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('contests:admin')
  @ApiOperation({ summary: 'Update contest details (Admin only)' })
  @ApiResponse({ status: 200, description: 'Contest updated' })
  async updateContest(
    @Param('id') id: string,
    @Body() dto: UpdateContestDto,
  ): Promise<Contest> {
    return this.contestsService.updateContest(id, dto);
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
