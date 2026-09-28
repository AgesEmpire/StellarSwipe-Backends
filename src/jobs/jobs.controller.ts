import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JobSchedulerService } from './job-scheduler.service';
import { HealthMetricsAuthGuard } from '../common/guards/health-metrics-auth.guard';

@Controller('jobs')
@UseGuards(HealthMetricsAuthGuard)
export class JobsController {
  constructor(private readonly scheduler: JobSchedulerService) {}

  /** Dashboard: status of all registered jobs. */
  @Get('status')
  getStatus() {
    return this.scheduler.getStatus();
  }

  /** Execution history for a single job. */
  @Get(':name/history')
  getHistory(@Param('name') name: string) {
    return this.scheduler.getHistory(name);
  }

  /** Trigger a job immediately (admin use). */
  @Post(':name/trigger')
  async trigger(@Param('name') name: string) {
    await this.scheduler.triggerNow(name);
    return { triggered: name, at: new Date().toISOString() };
  }

  /** Pause a job. */
  @Post(':name/pause')
  pause(@Param('name') name: string) {
    this.scheduler.pause(name);
    return { paused: name };
  }

  /** Resume a paused job. */
  @Post(':name/resume')
  resume(@Param('name') name: string) {
    this.scheduler.resume(name);
    return { resumed: name };
  }
}
