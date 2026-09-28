import { Controller, Get, Post, Delete, Body, Query, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { MobileApiService } from './mobile-api.service';
import { MobileFeedDto } from './dto/mobile-feed.dto';
import { BatchRequestDto } from './dto/batch-request.dto';

@Controller('mobile')
export class MobileApiController {
  constructor(private readonly mobileApiService: MobileApiService) {}

  @Get('feed')
  getFeed(@Query() query: MobileFeedDto) {
    return this.mobileApiService.getFeed(query.syncToken);
  }

  @Get('portfolio/:userId')
  getPortfolio(@Param('userId') userId: string) {
    return this.mobileApiService.getPortfolio(userId);
  }

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  batch(@Body() dto: BatchRequestDto) {
    return this.mobileApiService.processBatch(dto);
  }

  @Post('push-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  registerToken(
    @Body('userId') userId: string,
    @Body('token') token: string,
    @Body('platform') platform: 'ios' | 'android',
  ) {
    this.mobileApiService.registerPushToken(userId, token, platform);
  }

  @Delete('push-token/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  deregisterToken(@Param('token') token: string) {
    this.mobileApiService.deregisterPushToken(token);
  }
}
