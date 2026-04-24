import { Test, TestingModule } from '@nestjs/testing';
import { TimezoneService } from './timezone.service';
import { TimezoneConverter } from './utils/timezone-converter';
import { TradingHoursCalculator } from './utils/trading-hours-calculator';
import { MarketHoursDetector } from './utils/market-hours-detector';

describe('TimezoneService', () => {
  let service: TimezoneService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TimezoneService, TimezoneConverter, TradingHoursCalculator, MarketHoursDetector],
    }).compile();

    service = module.get<TimezoneService>(TimezoneService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should validate timezones', () => {
    expect(service.isValidTimezone('America/New_York')).toBe(true);
    expect(service.isValidTimezone('Europe/London')).toBe(true);
    expect(service.isValidTimezone('Invalid/Zone')).toBe(false);
  });

  it('should convert time between timezones', () => {
    const result = service.convertTime({
      timestamp: '2024-01-15T12:00:00Z',
      fromTimezone: 'UTC',
      toTimezone: 'America/New_York',
    });
    expect(result).toBeDefined();
    expect(result.fromTimezone).toBe('UTC');
    expect(result.toTimezone).toBe('America/New_York');
  });

  it('should throw for invalid timezone in conversion', () => {
    expect(() =>
      service.convertTime({
        timestamp: new Date(),
        fromTimezone: 'Invalid/Zone',
        toTimezone: 'UTC',
      }),
    ).toThrow('Invalid timezone');
  });

  it('should return market hours for NYSE', () => {
    const hours = service.getMarketHours('NYSE');
    expect(hours.market).toBe('NYSE');
    expect(hours.timezone).toBe('America/New_York');
    expect(hours.openTime).toBe('09:30');
    expect(hours.closeTime).toBe('16:00');
  });

  it('should return all supported markets', () => {
    const markets = service.getSupportedMarkets();
    expect(markets).toContain('NYSE');
    expect(markets).toContain('NGX');
    expect(markets).toContain('NSE');
  });

  it('should localize a UTC time to a given timezone', () => {
    const utc = new Date('2024-06-15T14:00:00Z');
    const localized = service.localizeTime(utc, 'Africa/Lagos');
    expect(localized.timezone).toBe('Africa/Lagos');
    expect(localized.utc).toBe(utc.toISOString());
  });

  it('should convert scheduled trade time to UTC', () => {
    const localTime = new Date('2024-01-15T09:30:00');
    const utcTime = service.getScheduledTradeTime(localTime, 'America/New_York');
    expect(utcTime).toBeInstanceOf(Date);
  });
});
