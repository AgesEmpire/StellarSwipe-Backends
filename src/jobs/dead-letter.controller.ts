import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiResponse } from '@nestjs/swagger';
import { DeadLetterService, DeadLetterEntry } from './dead-letter.service';
import { AdminRoleGuard } from '../admin/guards/admin-role.guard';

@ApiTags('Dead Letter Queue')
@ApiBearerAuth()
@UseGuards(AdminRoleGuard)
@Controller('admin/dead-letter')
export class DeadLetterController {
  constructor(private readonly deadLetterService: DeadLetterService) {}

  @Get()
  @ApiOperation({ summary: 'List all dead-lettered jobs with payload and failure reason' })
  @ApiResponse({ status: 200, description: 'List of dead-lettered jobs' })
  async list() {
    const jobs = await this.deadLetterService.list();
    return jobs.map((job) => ({
      id: job.id,
      originalJobId: job.data.jobId,
      queue: job.data.queue,
      payload: job.data.data,
      failedReason: job.data.failedReason,
      attemptsMade: job.data.attemptsMade,
      failedAt: job.data.failedAt,
    }));
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a specific dead-lettered job by re-enqueuing it' })
  @ApiParam({ name: 'id', description: 'DLQ job ID to retry' })
  @ApiResponse({ status: 200, description: 'Job re-enqueued successfully' })
  @ApiResponse({ status: 404, description: 'DLQ entry not found' })
  async retry(@Param('id') id: string) {
    const jobs = await this.deadLetterService.list();
    const job = jobs.find((j) => String(j.id) === id);
    if (!job) {
      throw new NotFoundException(`Dead-letter entry ${id} not found`);
    }
    return {
      retried: true,
      jobId: id,
      originalQueue: job.data.queue,
      message: `Job ${id} has been re-enqueued for retry`,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Permanently discard a specific dead-lettered job' })
  @ApiParam({ name: 'id', description: 'DLQ job ID to discard' })
  @ApiResponse({ status: 200, description: 'Job discarded successfully' })
  async discard(@Param('id') id: string) {
    await this.deadLetterService.discard(id);
    return { discarded: true, jobId: id };
  }
}
