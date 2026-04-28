import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ProfilerService } from './profiler.service';
import { ProfileConfigDto } from './dto/profile-config.dto';
import { ProfileSessionStatus } from './entities/profile-session.entity';

// Swap with your own auth guard
// import { JwtAuthGuard } from '../auth/jwt-auth.guard';
// import { Roles } from '../auth/roles.decorator';

@Controller('profiler')
// @UseGuards(JwtAuthGuard)
export class ProfilerController {
  constructor(private readonly profilerService: ProfilerService) {}

  /**
   * POST /profiler/sessions
   * Start a new profiling session.
   */
  @Post('sessions')
  @HttpCode(HttpStatus.ACCEPTED)
  async startSession(@Body() dto: ProfileConfigDto, @Req() req?: any) {
    const triggeredBy = req?.user?.id ?? req?.ip ?? 'api';
    const session = await this.profilerService.startSession(dto, triggeredBy);
    return {
      message: 'Profiling session started',
      sessionId: session.id,
      status: session.status,
      estimatedCompletionSeconds: session.durationSeconds,
    };
  }

  /**
   * GET /profiler/sessions
   * List past & active profiling sessions.
   */
  @Get('sessions')
  async listSessions(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('status') status?: ProfileSessionStatus,
  ) {
    return this.profilerService.listSessions(
      Math.min(limit, 100),
      offset,
      status,
    );
  }

  /**
   * GET /profiler/sessions/active
   * Return IDs of currently running sessions.
   */
  @Get('sessions/active')
  getActiveSessions() {
    return {
      activeSessionIds: this.profilerService.getActiveSessionIds(),
      count: this.profilerService.getActiveSessionIds().length,
    };
  }

  /**
   * GET /profiler/sessions/:id
   * Fetch a single session with its summary.
   */
  @Get('sessions/:id')
  async getSession(@Param('id', ParseUUIDPipe) id: string) {
    return this.profilerService.getSession(id);
  }

  /**
   * GET /profiler/sessions/:id/report
   * Generate the full performance report for a completed session.
   */
  @Get('sessions/:id/report')
  async getReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.profilerService.generateReport(id);
  }

  /**
   * DELETE /profiler/sessions/:id/cancel
   * Cancel an active session gracefully.
   */
  @Delete('sessions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelSession(@Param('id', ParseUUIDPipe) id: string) {
    await this.profilerService.cancelSession(id);
    return { message: `Session ${id} cancelled` };
  }

  /**
   * DELETE /profiler/sessions/:id
   * Permanently delete a completed/failed session and all its snapshots.
   */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSession(@Param('id', ParseUUIDPipe) id: string) {
    await this.profilerService.deleteSession(id);
  }

  /**
   * GET /profiler/health
   * Quick liveness check for the profiler subsystem.
   */
  @Get('health')
  health() {
    return {
      status: 'ok',
      activeSessions: this.profilerService.getActiveSessionIds().length,
      timestamp: new Date().toISOString(),
    };
  }
}
