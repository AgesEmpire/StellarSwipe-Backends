import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrencyConverterService } from './currency-converter.service';
import { ConvertCurrencyDto } from './dto/convert-currency.dto';
import { CurrencyPreferenceDto } from './dto/currency-preference.dto';
import { CacheResponse } from '../cache/response-cache.service';
import { ExternalIntegrationThrottlerGuard } from '../common/guards/external-integration-throttler.guard';

@Controller('currency')
@UseGuards(ExternalIntegrationThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60000 } })
export class CurrencyController {
  constructor(private readonly currencyService: CurrencyConverterService) {}

  @Get('supported')
  @CacheResponse({ ttlSeconds: 3600, keyPrefix: 'currency:supported' })
  getSupportedCurrencies() {
    return this.currencyService.getSupportedCurrencies();
  }

  @Get('rate')
  @CacheResponse({ ttlSeconds: 300 })
  getRate(@Query('base') base: string, @Query('quote') quote: string) {
    return this.currencyService.getRate(base, quote);
  }

  @Post('convert')
  @HttpCode(HttpStatus.OK)
  convert(@Body() dto: ConvertCurrencyDto) {
    return this.currencyService.convert(dto.amount, dto.from, dto.to);
  }

  @Get('preference')
  @UseGuards(JwtAuthGuard)
  getPreference(@Request() req: any) {
    return this.currencyService.getUserPreferredCurrency(req.user.sub ?? req.user.id);
  }

  @Post('preference')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  setPreference(@Request() req: any, @Body() dto: CurrencyPreferenceDto) {
    return this.currencyService.setUserPreferredCurrency(
      req.user.sub ?? req.user.id,
      dto.preferredCurrency,
    );
  }
}
