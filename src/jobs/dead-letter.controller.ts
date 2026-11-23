import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiParam, ApiResponse } from '@nestjs/swagger';
import { DeadLetterService, DeadLetterEntry } from './dead-letter.service';
import { ReplayDeadLetterDto } from './dto/replay-dead-letter.dto';
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
  @ApiOperation({ summary: 'Replay one dead-lettered job as a new attempt on its original queue' })
  @ApiParam({ name: 'id', description: 'DLQ job ID to replay' })
  @ApiBody({ type: ReplayDeadLetterDto })
  @ApiResponse({ status: 200, description: 'Job re-enqueued successfully' })
  @ApiResponse({ status: 400, description: 'Original queue is not registered for replay' })
  @ApiResponse({ status: 404, description: 'DLQ entry not found' })
  @ApiResponse({ status: 409, description: 'DLQ entry has already been replayed' })
  async retry(
    @Param('id') id: string,
    @Body() dto: ReplayDeadLetterDto,
    @Request() req: any,
  ) {
    const replayJob = await this.deadLetterService.replay(id, req.user?.id, dto.reason);
    return {
      retried: true,
      jobId: id,
      replayJobId: replayJob.id,
      originalQueue: replayJob.queue.name,
      message: `Job ${id} has been re-enqueued for replay`,
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
