import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { TimezoneService } from './timezone.service';
import { UserTimezone } from './decorators/timezone-aware.decorator';
import { TimezoneConversionRequest } from './interfaces/timezone-conversion.interface';

@Controller('time')
export class TimezoneController {
  constructor(private readonly timezoneService: TimezoneService) {}

  @Get('now')
  getCurrentTime(@UserTimezone() timezone: string) {
    const utc = this.timezoneService.getCurrentUtc();
    return this.timezoneService.localizeTime(utc, timezone);
  }

  @Post('convert')
  convertTime(@Body() request: TimezoneConversionRequest) {
    return this.timezoneService.convertTime(request);
  }

  @Get('validate/:timezone')
  validateTimezone(@Param('timezone') timezone: string) {
    return { timezone, valid: this.timezoneService.isValidTimezone(timezone) };
  }

  @Get('markets')
  getAllMarketsStatus() {
    return this.timezoneService.getAllMarketsStatus();
  }

  @Get('markets/open')
  getOpenMarkets() {
    return this.timezoneService.getOpenMarkets();
  }

  @Get('markets/:market')
  getMarketHours(@Param('market') market: string) {
    return this.timezoneService.getMarketHours(market);
  }

  @Get('localize')
  localizeTime(
    @Query('timestamp') timestamp: string,
    @UserTimezone() timezone: string,
  ) {
    const date = timestamp ? new Date(timestamp) : new Date();
    return this.timezoneService.localizeTime(date, timezone);
  }
}
