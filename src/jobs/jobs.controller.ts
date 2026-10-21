import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JobSchedulerService } from './job-scheduler.service';
import { HealthMetricsAuthGuard } from '../common/guards/health-metrics-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../authorization/guards/roles.guard';
import { Roles } from '../authorization/decorators/roles.decorator';
import { PriorityQueueService } from '../queue/priority-queue.service';

@Controller('jobs')
@UseGuards(HealthMetricsAuthGuard)
export class JobsController {
  constructor(
    private readonly scheduler: JobSchedulerService,
    private readonly priorityQueue: PriorityQueueService,
  ) {}

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

  /** Lifecycle state for a cancellable queue job. */
  @Get('queue/:queueName/:jobId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getQueueJobLifecycle(
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
  ) {
    const status = await this.priorityQueue.getJobLifecycle(queueName, jobId);
    return { queue: queueName, jobId, status };
  }

  /** Request cooperative cancellation of a cancellable queue job. */
  @Post('queue/:queueName/:jobId/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async cancelQueueJob(
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
  ) {
    const status = await this.priorityQueue.requestCancellation(
      queueName,
      jobId,
    );
    return { queue: queueName, jobId, status };
  }
}
