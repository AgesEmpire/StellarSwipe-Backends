import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DeadLetterService } from './dead-letter.service';
import { DeadLetterRecord, DeadLetterStatus } from './dead-letter.types';

/**
 * Operator-facing endpoints for inspecting and replaying dead-lettered
 * queue messages. Replay is only allowed for records that are still in a
 * terminal (dead-lettered) state and have not exceeded the replay limit.
 */
@Controller('queue/dead-letter')
export class DeadLetterController {
  constructor(private readonly deadLetterService: DeadLetterService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('queue') queue?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: DeadLetterRecord[]; total: number }> {
    const parsedLimit = limit !== undefined ? Number(limit) : undefined;
    if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit <= 0)) {
      throw new BadRequestException('limit must be a positive integer');
    }

    const normalizedStatus = status as DeadLetterStatus | undefined;
    if (
      normalizedStatus !== undefined &&
      normalizedStatus !== DeadLetterStatus.DeadLettered &&
      normalizedStatus !== DeadLetterStatus.Replayed
    ) {
      throw new BadRequestException('status must be one of: dead_lettered, replayed');
    }

    return this.deadLetterService.list({
      status: normalizedStatus,
      queue,
      limit: parsedLimit,
    });
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<DeadLetterRecord> {
    const record = await this.deadLetterService.get(id);
    if (!record) {
      throw new NotFoundException(`Dead-letter record ${id} not found`);
    }
    return record;
  }

  @Post(':id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  async replay(@Param('id') id: string): Promise<DeadLetterRecord> {
    const record = await this.deadLetterService.get(id);
    if (!record) {
      throw new NotFoundException(`Dead-letter record ${id} not found`);
    }
    if (record.status !== DeadLetterStatus.DeadLettered) {
      throw new BadRequestException(
        `Dead-letter record ${id} is not eligible for replay (status: ${record.status})`,
      );
    }
    return this.deadLetterService.replay(id);
  }
}
