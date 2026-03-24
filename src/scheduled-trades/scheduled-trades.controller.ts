import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
} from '@nestjs/common';
import { ScheduledTradesService } from './scheduled-trades.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { ScheduledTrade } from './entities/scheduled-trade.entity';

@Controller('scheduled-trades')
export class ScheduledTradesController {
  constructor(
    private readonly scheduledTradesService: ScheduledTradesService,
  ) {}

  @Post()
  create(@Body() dto: CreateScheduleDto): Promise<ScheduledTrade> {
    return this.scheduledTradesService.create(dto);
  }

  @Get('user/:userId')
  findAll(@Param('userId') userId: string): Promise<ScheduledTrade[]> {
    return this.scheduledTradesService.findAll(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<ScheduledTrade> {
    return this.scheduledTradesService.findOne(id);
  }

  @Patch(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ): Promise<ScheduledTrade> {
    return this.scheduledTradesService.cancel(id, userId);
  }
}
