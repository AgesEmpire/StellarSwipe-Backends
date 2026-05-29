import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { PricingFallbackService } from './pricing-fallback.service';

describe('PricingFallbackService', () => {
  let service: PricingFallbackService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PricingFallbackService],
    }).compile();

    service = module.get<PricingFallbackService>(PricingFallbackService);
  });

  describe('getPriceWithFallback', () => {
    it('should return price from primary source when available', async () => {
      jest.spyOn(service as any, 'fetchPrice').mockResolvedValue(1.5);

      const config = { primarySource: 'coingecko', fallbackSources: ['binance', 'coinbase'], timeoutMs: 5000 };
      const result = await service.getPriceWithFallback('XLM/USDC', config);

      expect(result.isFallback).toBe(false);
      expect(result.source).toBe('coingecko');
      expect(result.price).toBe(1.5);
    });

    it('should use fallback source when primary is unavailable', async () => {
      jest.spyOn(service as any, 'fetchPrice').mockResolvedValue(1.48);
      service.markSourceUnavailable('coingecko');

      const config = { primarySource: 'coingecko', fallbackSources: ['binance', 'coinbase'] };
      const result = await service.getPriceWithFallback('XLM/USDC', config);

      expect(result.isFallback).toBe(true);
      expect(result.source).toBe('binance');
    });

    it('should throw ServiceUnavailableException when all sources unavailable', async () => {
      service.markSourceUnavailable('coingecko');
      service.markSourceUnavailable('binance');

      const config = { primarySource: 'coingecko', fallbackSources: ['binance'] };
      await expect(service.getPriceWithFallback('XLM/USDC', config)).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('markSourceUnavailable / markSourceAvailable', () => {
    it('should restore source after marking available', async () => {
      jest.spyOn(service as any, 'fetchPrice').mockResolvedValue(1.5);
      service.markSourceUnavailable('coingecko');
      service.markSourceAvailable('coingecko');

      const config = { primarySource: 'coingecko', fallbackSources: ['binance'] };
      const result = await service.getPriceWithFallback('XLM/USDC', config);
      expect(result.isFallback).toBe(false);
    });
  });
});
