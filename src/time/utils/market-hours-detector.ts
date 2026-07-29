import { Injectable } from '@nestjs/common';
import { TradingHoursCalculator } from './trading-hours-calculator';
import { MarketHoursInfo } from '../interfaces/timezone-conversion.interface';
import { TimezoneConverter } from './timezone-converter';

@Injectable()
export class MarketHoursDetector {
  constructor(
    private readonly calculator: TradingHoursCalculator,
    private readonly converter: TimezoneConverter,
  ) {}

  getOpenMarkets(referenceDate?: Date): MarketHoursInfo[] {
    const markets = this.calculator.getSupportedMarkets();
    return markets
      .map((market) => this.getMarketInfo(market, referenceDate))
      .filter((info) => info.tradingHours.isOpen);
  }

  getMarketInfo(market: string, referenceDate?: Date): MarketHoursInfo {
    const tradingHours = this.calculator.getMarketHours(market, referenceDate);
    const now = referenceDate ?? new Date();
    const localized = this.converter.toLocalizedTime(now, tradingHours.timezone);

    return {
      market,
      timezone: tradingHours.timezone,
      tradingHours,
      currentLocalTime: localized.local,
    };
  }

  getAllMarketsStatus(referenceDate?: Date): MarketHoursInfo[] {
    return this.calculator.getSupportedMarkets().map((m) => this.getMarketInfo(m, referenceDate));
  }

  isAnyMarketOpen(referenceDate?: Date): boolean {
    return this.getOpenMarkets(referenceDate).length > 0;
  }
}
