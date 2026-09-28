import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExchangeRate } from './entities/exchange-rate.entity';
import { CurrencyPreference } from './entities/currency-preference.entity';
import { BaseForexProvider } from './providers/base-forex.provider';
import { CacheService } from '../cache/cache.service';
import { convertAmount } from './utils/rate-calculator';

const RATE_CACHE_TTL = 300; // 5 min
const RATE_CACHE_NS = 'stellarswipe:fx:';

@Injectable()
export class CurrencyConverterService {
  private readonly logger = new Logger(CurrencyConverterService.name);

  constructor(
    @InjectRepository(ExchangeRate)
    private readonly rateRepo: Repository<ExchangeRate>,
    @InjectRepository(CurrencyPreference)
    private readonly prefRepo: Repository<CurrencyPreference>,
    private readonly cacheService: CacheService,
    private readonly forexProvider: BaseForexProvider,
  ) {}

  async getRate(base: string, quote: string): Promise<number> {
    if (base === quote) return 1;

    const cacheKey = `${RATE_CACHE_NS}${base}:${quote}`;
    const cached = await this.cacheService.get<number>(cacheKey);
    if (cached !== undefined && cached !== null) return cached;

    // Try DB first (latest stored rate)
    const stored = await this.rateRepo.findOne({
      where: { baseCurrency: base, quoteCurrency: quote },
      order: { fetchedAt: 'DESC' },
    });

    if (stored) {
      await this.cacheService.setWithTTL(cacheKey, stored.rate, RATE_CACHE_TTL);
      return stored.rate;
    }

    // Fetch live from provider
    const live = await this.forexProvider.getRate(base, quote);
    await this.persistRate(live.base, live.quote, live.rate, live.provider);
    await this.cacheService.setWithTTL(cacheKey, live.rate, RATE_CACHE_TTL);
    return live.rate;
  }

  async convert(amount: number, from: string, to: string): Promise<{ result: number; rate: number }> {
    const rate = await this.getRate(from, to);
    return { result: convertAmount(amount, rate), rate };
  }

  async getUserPreferredCurrency(userId: string): Promise<string> {
    const pref = await this.prefRepo.findOne({ where: { userId } });
    return pref?.preferredCurrency ?? 'USD';
  }

  async setUserPreferredCurrency(userId: string, currency: string): Promise<CurrencyPreference> {
    let pref = await this.prefRepo.findOne({ where: { userId } });
    if (pref) {
      pref.preferredCurrency = currency;
    } else {
      pref = this.prefRepo.create({ userId, preferredCurrency: currency });
    }
    return this.prefRepo.save(pref);
  }

  async getSupportedCurrencies(): Promise<string[]> {
    return this.forexProvider.getSupportedCurrencies();
  }

  async refreshRates(pairs: { base: string; quote: string }[]): Promise<void> {
    for (const { base, quote } of pairs) {
      try {
        const live = await this.forexProvider.getRate(base, quote);
        await this.persistRate(live.base, live.quote, live.rate, live.provider);
        const cacheKey = `${RATE_CACHE_NS}${base}:${quote}`;
        await this.cacheService.setWithTTL(cacheKey, live.rate, RATE_CACHE_TTL);
      } catch (err) {
        this.logger.error(`Failed to refresh rate ${base}/${quote}: ${(err as Error).message}`);
      }
    }
  }

  private async persistRate(
    base: string,
    quote: string,
    rate: number,
    provider: string,
  ): Promise<void> {
    const entry = this.rateRepo.create({ baseCurrency: base, quoteCurrency: quote, rate, provider });
    await this.rateRepo.save(entry);
  }
}
