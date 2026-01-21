import { Controller, Get, Query } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { PositionDetailDto } from './dto/position-detail.dto';
import { PortfolioSummaryDto } from './dto/portfolio-summary.dto';
import { Trade } from '../trades/entities/trade.entity';

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get('positions')
  async getPositions(@Query('userId') userId: string): Promise<PositionDetailDto[]> {
    // In a real app, userId would likely come from the request user (via Guard/Decorator)
    return this.portfolioService.getPositions(userId);
  }

  @Get('history')
  async getHistory(
    @Query('userId') userId: string,
    @Query('page') page: number,
    @Query('limit') limit: number,
  ): Promise<{ data: Trade[]; total: number }> {
    return this.portfolioService.getHistory(userId, page, limit);
  }

  @Get('performance')
  // @UseInterceptors(CacheInterceptor) // Caching is handled manually in service
  async getPerformance(@Query('userId') userId: string): Promise<PortfolioSummaryDto> {
    return this.portfolioService.getPerformance(userId);
  }
}
