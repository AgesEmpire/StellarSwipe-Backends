import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OutboxService } from './outbox.service';

@Controller('admin/outbox')
@UseGuards(JwtAuthGuard)
export class OutboxController {
  constructor(private readonly outbox: OutboxService) {}

  @Get('stats')
  stats() {
    return this.outbox.stats();
  }

  @Post('replay')
  async replay(@Body() body: { ids?: string[] }) {
    return { requeued: await this.outbox.replay(body?.ids) };
  }
}
