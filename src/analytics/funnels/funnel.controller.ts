import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { FunnelTrackerService } from './funnel-tracker.service';
import { TrackFunnelStepDto } from './dto/funnel-config.dto';
import { FunnelAnalysisDto } from './dto/funnel-analysis.dto';

@Controller('analytics/funnels')
export class FunnelController {
  constructor(private readonly funnelTrackerService: FunnelTrackerService) {}

  @Post('track')
  track(@Body() dto: TrackFunnelStepDto) {
    return this.funnelTrackerService.trackStep(dto);
  }

  @Get('analysis')
  analyze(@Query() dto: FunnelAnalysisDto) {
    return this.funnelTrackerService.analyzeFunnel(dto);
  }

  @Get('report/:funnelName')
  report(
    @Param('funnelName') funnelName: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.funnelTrackerService.getConversionReport(funnelName, from, to);
  }

  @Get('progress/:userId/:funnelName')
  getUserProgress(
    @Param('userId') userId: string,
    @Param('funnelName') funnelName: string,
  ) {
    return this.funnelTrackerService.getUserProgress(userId, funnelName);
  }
}
