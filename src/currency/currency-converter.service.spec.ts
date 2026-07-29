import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CurrencyConverterService } from './currency-converter.service';
import { ExchangeRate } from './entities/exchange-rate.entity';
import { CurrencyPreference } from './entities/currency-preference.entity';
import { BaseForexProvider } from './providers/base-forex.provider';
import { CacheService } from '../cache/cache.service';

const mockRateRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockPrefRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockCacheService = {
  get: jest.fn(),
  setWithTTL: jest.fn().mockResolvedValue(undefined),
};

const mockForexProvider = {
  getRate: jest.fn(),
  getSupportedCurrencies: jest.fn().mockResolvedValue(['USD', 'EUR', 'XLM']),
};

describe('CurrencyConverterService', () => {
  let service: CurrencyConverterService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CurrencyConverterService,
        { provide: getRepositoryToken(ExchangeRate), useValue: mockRateRepo },
        { provide: getRepositoryToken(CurrencyPreference), useValue: mockPrefRepo },
        { provide: CacheService, useValue: mockCacheService },
        { provide: BaseForexProvider, useValue: mockForexProvider },
      ],
    }).compile();

    service = module.get(CurrencyConverterService);
  });

  describe('getRate', () => {
    it('returns 1 for same currency', async () => {
      expect(await service.getRate('USD', 'USD')).toBe(1);
    });

    it('returns cached rate when available', async () => {
      mockCacheService.get.mockResolvedValueOnce(1.08);
      expect(await service.getRate('USD', 'EUR')).toBe(1.08);
      expect(mockRateRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns stored DB rate on cache miss', async () => {
      mockCacheService.get.mockResolvedValueOnce(undefined);
      mockRateRepo.findOne.mockResolvedValueOnce({ rate: 1.07, baseCurrency: 'USD', quoteCurrency: 'EUR' });
      expect(await service.getRate('USD', 'EUR')).toBe(1.07);
    });

    it('fetches live rate when DB and cache miss', async () => {
      mockCacheService.get.mockResolvedValueOnce(undefined);
      mockRateRepo.findOne.mockResolvedValueOnce(null);
      mockForexProvider.getRate.mockResolvedValueOnce({
        base: 'USD', quote: 'EUR', rate: 1.05, provider: 'fixer.io', fetchedAt: new Date(),
      });
      mockRateRepo.create.mockReturnValueOnce({});
      mockRateRepo.save.mockResolvedValueOnce({});
      expect(await service.getRate('USD', 'EUR')).toBe(1.05);
    });
  });

  describe('convert', () => {
    it('converts amount using rate', async () => {
      mockCacheService.get.mockResolvedValueOnce(1.1);
      const result = await service.convert(100, 'USD', 'EUR');
      expect(result.result).toBeCloseTo(110, 5);
      expect(result.rate).toBe(1.1);
    });
  });

  describe('getUserPreferredCurrency', () => {
    it('returns stored preference', async () => {
      mockPrefRepo.findOne.mockResolvedValueOnce({ preferredCurrency: 'GBP' });
      expect(await service.getUserPreferredCurrency('user-1')).toBe('GBP');
    });

    it('defaults to USD when no preference set', async () => {
      mockPrefRepo.findOne.mockResolvedValueOnce(null);
      expect(await service.getUserPreferredCurrency('user-1')).toBe('USD');
    });
  });

  describe('setUserPreferredCurrency', () => {
    it('creates new preference when none exists', async () => {
      mockPrefRepo.findOne.mockResolvedValueOnce(null);
      mockPrefRepo.create.mockReturnValueOnce({ userId: 'user-1', preferredCurrency: 'EUR' });
      mockPrefRepo.save.mockResolvedValueOnce({ userId: 'user-1', preferredCurrency: 'EUR' });
      const result = await service.setUserPreferredCurrency('user-1', 'EUR');
      expect(result.preferredCurrency).toBe('EUR');
    });

    it('updates existing preference', async () => {
      const existing = { userId: 'user-1', preferredCurrency: 'USD' };
      mockPrefRepo.findOne.mockResolvedValueOnce(existing);
      mockPrefRepo.save.mockResolvedValueOnce({ ...existing, preferredCurrency: 'JPY' });
      const result = await service.setUserPreferredCurrency('user-1', 'JPY');
      expect(result.preferredCurrency).toBe('JPY');
    });
  });
});
