export interface TimezoneConversionRequest {
  timestamp: Date | string;
  fromTimezone: string;
  toTimezone: string;
}

export interface TimezoneConversionResult {
  original: string;
  converted: string;
  fromTimezone: string;
  toTimezone: string;
  offsetMinutes: number;
}

export interface TradingHours {
  market: string;
  timezone: string;
  openTime: string;
  closeTime: string;
  isOpen: boolean;
  nextOpenAt?: Date;
  nextCloseAt?: Date;
}

export interface LocalizedTime {
  utc: string;
  local: string;
  timezone: string;
  offset: string;
  isDST: boolean;
}

export interface MarketHoursInfo {
  market: string;
  timezone: string;
  tradingHours: TradingHours;
  currentLocalTime: string;
}
