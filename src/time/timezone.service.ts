import { Injectable, BadRequestException } from '@nestjs/common';
import { TimezoneConverter } from './utils/timezone-converter';
import { TradingHoursCalculator } from './utils/trading-hours-calculator';
import { MarketHoursDetector } from './utils/market-hours-detector';
import {
  TimezoneConversionRequest,
  TimezoneConversionResult,
  LocalizedTime,
  MarketHoursInfo,
  TradingHours,
} from './interfaces/timezone-conversion.interface';

@Injectable()
export class TimezoneService {
  constructor(
    private readonly converter: TimezoneConverter,
    private readonly tradingHoursCalc: TradingHoursCalculator,
    private readonly marketDetector: MarketHoursDetector,
  ) {}

  convertTime(request: TimezoneConversionRequest): TimezoneConversionResult {
    if (!this.converter.isValidTimezone(request.fromTimezone)) {
      throw new BadRequestException(`Invalid timezone: ${request.fromTimezone}`);
    }
    if (!this.converter.isValidTimezone(request.toTimezone)) {
      throw new BadRequestException(`Invalid timezone: ${request.toTimezone}`);
    }
    return this.converter.convert(request);
  }

  localizeTime(utcDate: Date, timezone: string): LocalizedTime {
    if (!this.converter.isValidTimezone(timezone)) {
      throw new BadRequestException(`Invalid timezone: ${timezone}`);
    }
    return this.converter.toLocalizedTime(utcDate, timezone);
  }

  getMarketHours(market: string): TradingHours {
    return this.tradingHoursCalc.getMarketHours(market);
  }

  getAllMarketsStatus(): MarketHoursInfo[] {
    return this.marketDetector.getAllMarketsStatus();
  }

  getOpenMarkets(): MarketHoursInfo[] {
    return this.marketDetector.getOpenMarkets();
  }

  isMarketOpen(market: string): boolean {
    return this.tradingHoursCalc.getMarketHours(market).isOpen;
  }

  getSupportedMarkets(): string[] {
    return this.tradingHoursCalc.getSupportedMarkets();
  }

  isValidTimezone(timezone: string): boolean {
    return this.converter.isValidTimezone(timezone);
  }

  getCurrentUtc(): Date {
    return new Date();
  }

  getScheduledTradeTime(tradeTimeLocal: Date, fromTimezone: string): Date {
    const result = this.converter.convert({
      timestamp: tradeTimeLocal,
      fromTimezone,
      toTimezone: 'UTC',
    });
    return new Date(result.converted);
  }
}
