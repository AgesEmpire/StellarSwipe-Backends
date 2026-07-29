import { Injectable } from '@nestjs/common';
import { TradingHours } from '../interfaces/timezone-conversion.interface';
import { TimezoneConverter } from './timezone-converter';

interface MarketSchedule {
  timezone: string;
  openHour: number;
  openMinute: number;
  closeHour: number;
  closeMinute: number;
  tradingDays: number[]; // 0=Sun, 1=Mon ... 6=Sat
}

const MARKETS: Record<string, MarketSchedule> = {
  NYSE: { timezone: 'America/New_York', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  NASDAQ: { timezone: 'America/New_York', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  LSE: { timezone: 'Europe/London', openHour: 8, openMinute: 0, closeHour: 16, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
  TSX: { timezone: 'America/Toronto', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  NGX: { timezone: 'Africa/Lagos', openHour: 10, openMinute: 0, closeHour: 14, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
  NSE: { timezone: 'Asia/Kolkata', openHour: 9, openMinute: 15, closeHour: 15, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
};

@Injectable()
export class TradingHoursCalculator {
  constructor(private readonly converter: TimezoneConverter) {}

  getMarketHours(market: string, referenceDate?: Date): TradingHours {
    const schedule = MARKETS[market.toUpperCase()];
    if (!schedule) throw new Error(`Unknown market: ${market}`);

    const now = referenceDate ?? new Date();
    const localNow = new Date(now.toLocaleString('en-US', { timeZone: schedule.timezone }));
    const dayOfWeek = localNow.getDay();

    const todayOpen = new Date(localNow);
    todayOpen.setHours(schedule.openHour, schedule.openMinute, 0, 0);

    const todayClose = new Date(localNow);
    todayClose.setHours(schedule.closeHour, schedule.closeMinute, 0, 0);

    const isTradingDay = schedule.tradingDays.includes(dayOfWeek);
    const isOpen = isTradingDay && localNow >= todayOpen && localNow < todayClose;

    return {
      market: market.toUpperCase(),
      timezone: schedule.timezone,
      openTime: `${String(schedule.openHour).padStart(2, '0')}:${String(schedule.openMinute).padStart(2, '0')}`,
      closeTime: `${String(schedule.closeHour).padStart(2, '0')}:${String(schedule.closeMinute).padStart(2, '0')}`,
      isOpen,
      nextOpenAt: isOpen ? undefined : this.getNextOpen(schedule, localNow),
      nextCloseAt: isOpen ? this.toUtc(todayClose, schedule.timezone) : undefined,
    };
  }

  getSupportedMarkets(): string[] {
    return Object.keys(MARKETS);
  }

  private getNextOpen(schedule: MarketSchedule, localNow: Date): Date {
    const next = new Date(localNow);
    next.setHours(schedule.openHour, schedule.openMinute, 0, 0);

    if (next <= localNow) next.setDate(next.getDate() + 1);

    while (!schedule.tradingDays.includes(next.getDay())) {
      next.setDate(next.getDate() + 1);
    }

    return this.toUtc(next, schedule.timezone);
  }

  private toUtc(localDate: Date, timezone: string): Date {
    const offset = this.converter.getOffsetMinutes(localDate, timezone);
    return new Date(localDate.getTime() - offset * 60 * 1000);
  }
}
