import { Injectable, BadRequestException } from '@nestjs/common';
import { TimezoneConversionRequest, TimezoneConversionResult, LocalizedTime } from '../interfaces/timezone-conversion.interface';

@Injectable()
export class TimezoneConverter {
  convert(request: TimezoneConversionRequest): TimezoneConversionResult {
    const date = new Date(request.timestamp);
    if (isNaN(date.getTime())) throw new BadRequestException('Invalid timestamp');

    const fromOffset = this.getOffsetMinutes(date, request.fromTimezone);
    const toOffset = this.getOffsetMinutes(date, request.toTimezone);
    const offsetMinutes = toOffset - fromOffset;

    const convertedDate = new Date(date.getTime() + offsetMinutes * 60 * 1000);

    return {
      original: date.toISOString(),
      converted: convertedDate.toISOString(),
      fromTimezone: request.fromTimezone,
      toTimezone: request.toTimezone,
      offsetMinutes,
    };
  }

  toLocalizedTime(utcDate: Date, timezone: string): LocalizedTime {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    });

    const offsetMinutes = this.getOffsetMinutes(utcDate, timezone);
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetMins = Math.abs(offsetMinutes) % 60;
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const offset = `${sign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;

    return {
      utc: utcDate.toISOString(),
      local: formatter.format(utcDate),
      timezone,
      offset,
      isDST: this.isDST(utcDate, timezone),
    };
  }

  getOffsetMinutes(date: Date, timezone: string): number {
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    return (tzDate.getTime() - utcDate.getTime()) / (60 * 1000);
  }

  private isDST(date: Date, timezone: string): boolean {
    const jan = new Date(date.getFullYear(), 0, 1);
    const jul = new Date(date.getFullYear(), 6, 1);
    const janOffset = this.getOffsetMinutes(jan, timezone);
    const julOffset = this.getOffsetMinutes(jul, timezone);
    const stdOffset = Math.min(janOffset, julOffset);
    return this.getOffsetMinutes(date, timezone) !== stdOffset;
  }

  isValidTimezone(timezone: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }
}
