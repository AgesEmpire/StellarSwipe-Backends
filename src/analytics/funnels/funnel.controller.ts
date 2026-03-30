import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FunnelTrackerService } from './funnel-tracker.service';
import { FunnelConfigDto } from './dto/funnel-config.dto';

@Controller('analytics/funnels')
export class FunnelController {
  constructor(private readonly funnelTrackerService: FunnelTrackerService) {}

  @Post()
  create(@Body() dto: FunnelConfigDto) {
    return this.funnelTrackerService.createFunnel(dto);
  }

  @Post(':funnelName/steps/:stepKey/users/:userId')
  recordStep(
    @Param('userId') userId: string,
    @Param('funnelName') funnelName: string,
    @Param('stepKey') stepKey: string,
  ) {
    return this.funnelTrackerService.recordStep(userId, funnelName, stepKey);
  }

  @Get(':id/analysis')
  analyze(@Param('id', ParseUUIDPipe) id: string) {
    return this.funnelTrackerService.analyzeFunnel(id);
  }

  @Get(':id/conversion-report')
  conversionReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.funnelTrackerService.getConversionReport(
      id,
      new Date(from),
      new Date(to),
    );
  }
}
