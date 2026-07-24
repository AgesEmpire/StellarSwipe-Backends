import { Controller, ForbiddenException, Get, Query, Request, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

interface FailedJobSummary {
  id: string | number;
  name: string;
  failedReason?: string;
  attemptsMade: number;
  timestamp: number;
  data: unknown;
}

@UseGuards(JwtAuthGuard)
@Controller('admin/trades')
export class TradeDlqController {
  constructor(@InjectQueue('transactions') private readonly transactionsQueue: Queue) {}

  /**
   * GET /admin/trades/failed-jobs
   * Failed-queue depth and the most recent dead-lettered transaction
   * monitoring cycles, for operator visibility into systemic failures
   * (e.g. a broken Soroban RPC endpoint).
   */
  @Get('failed-jobs')
  async getFailedJobs(
    @Request() req: any,
    @Query('limit') limit = '10',
  ): Promise<{ failedCount: number; jobs: FailedJobSummary[] }> {
    const isAdmin: boolean = req.user?.roles?.includes('admin') ?? false;
    if (!isAdmin) {
      throw new ForbiddenException('Admin role required');
    }

    const take = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const [failedCount, jobs] = await Promise.all([
      this.transactionsQueue.getFailedCount(),
      this.transactionsQueue.getFailed(0, take - 1),
    ]);

    return {
      failedCount,
      jobs: jobs.map((job) => ({
        id: job.id,
        name: job.name,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp,
        data: job.data,
      })),
    };
  }
}
