import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { SdexPriceProvider } from './sdex-price.provider';
import { CoinGeckoPriceProvider } from './coingecko-price.provider';
import { StellarExpertPriceProvider } from './stellar-expert-price.provider';
import { PriceOracleProvider } from '../interfaces/price-oracle-provider.interface';

/**
 * Verifies every pluggable provider honours the shared
 * `PriceOracleProvider` contract so they remain interchangeable.
 */
describe('PriceOracleProvider contract', () => {
  describe('CoinGeckoPriceProvider', () => {
    const httpService = {
      get: jest.fn(() => of({ data: { stellar: { 'usd-coin': 0.12 } } })),
    } as unknown as HttpService;
    const provider: PriceOracleProvider = new CoinGeckoPriceProvider(
      httpService,
    );

    it('returns a PriceSourceResult', async () => {
      const result = await provider.getPrice('XLM-USDC');
      expect(result).toEqual(
        expect.objectContaining({
          price: 0.12,
          source: 'CoinGecko',
          timestamp: expect.any(Date),
        }),
      );
    });
  });

  describe('StellarExpertPriceProvider', () => {
    const httpService = {
      get: jest.fn(() => of({ data: { price: '0.13' } })),
    } as unknown as HttpService;
    const provider: PriceOracleProvider = new StellarExpertPriceProvider(
      httpService,
    );

    it('returns a PriceSourceResult', async () => {
      const result = await provider.getPrice('XLM-USDC');
      expect(result).toEqual(
        expect.objectContaining({
          price: 0.13,
          source: 'StellarExpert',
          timestamp: expect.any(Date),
        }),
      );
    });
  });

  describe('SdexPriceProvider', () => {
    const provider: PriceOracleProvider = new SdexPriceProvider();

    beforeEach(() => {
      (provider as unknown as SdexPriceProvider)['server'] = {
        orderbook: () => ({
          limit: () => ({
            call: () =>
              Promise.resolve({
                bids: [{ price: '0.10' }],
                asks: [{ price: '0.12' }],
              }),
          }),
        }),
      } as never;
    });

    it('returns a PriceSourceResult', async () => {
      const result = await provider.getPrice('XLM-USDC');
      expect(result).toEqual(
        expect.objectContaining({
          price: 0.11,
          source: 'SDEX',
          timestamp: expect.any(Date),
        }),
      );
    });
  });
});
