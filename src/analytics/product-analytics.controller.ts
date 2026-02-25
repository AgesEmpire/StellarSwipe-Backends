import {
  Controller,
  Post,
  Delete,
  Get,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { ProductAnalyticsService } from './product-analytics.service';

@ApiTags('Analytics')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard)
@Controller('analytics')
export class ProductAnalyticsController {
  constructor(private readonly analytics: ProductAnalyticsService) {}

  @Post('opt-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Opt out of product analytics (GDPR)' })
  async optOut(@Req() req: Request) {
    const userId = (req as any).user?.id;
    await this.analytics.optOut(userId);
    return { message: 'You have been opted out of product analytics.' };
  }

  @Delete('opt-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Opt back into product analytics' })
  async optIn(@Req() req: Request) {
    const userId = (req as any).user?.id;
    await this.analytics.optIn(userId);
    return { message: 'You have been opted back in to product analytics.' };
  }

  @Get('status')
  @ApiOperation({ summary: 'Check current analytics opt-out status' })
  async getStatus(@Req() req: Request) {
    const userId = (req as any).user?.id;
    const optedOut = await this.analytics.isOptedOut(userId);
    return { optedOut };
  }
}
