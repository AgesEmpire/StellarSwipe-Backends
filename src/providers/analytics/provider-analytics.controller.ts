import {
  Controller,
  Get,
  Query,
  Request,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProviderAnalyticsService } from './provider-analytics.service';

@Controller('providers/analytics')
@UseGuards(JwtAuthGuard)
export class ProviderAnalyticsController {
  constructor(
    private readonly analyticsService: ProviderAnalyticsService,
  ) {}

  @Get()
  async getAnalytics(
    @Request() req: { user?: { userId?: string } },
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const providerId = req.user?.userId;
    if (!providerId) {
      throw new UnauthorizedException('Authenticated user not found in request');
    }

    return this.analyticsService.getAnalytics(providerId, startDate, endDate);
  }
}
