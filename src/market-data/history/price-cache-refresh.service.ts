import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { Repository } from 'typeorm';
import { PriceHistory } from '../../prices/entities/price-history.entity';
import {
  readHistoricalPriceCache,
  writeHistoricalPriceCache,
} from './utils/cache-writer';

export interface HistoricalPriceRefreshResult {
  assetPair: string;
  refreshed: boolean;
  attempts: number;
  cachedRows: number;
  error?: string;
}

export interface HistoricalPriceRefreshSummary {
  lookbackHours: number;
  refreshedAt: string;
  results: HistoricalPriceRefreshResult[];
}

@Injectable()
export class PriceCacheRefreshService {
  private readonly logger = new Logger(PriceCacheRefreshService.name);
  private readonly defaultLookbackHours = 168;
  private readonly maxAttempts = 3;

  constructor(
    @InjectRepository(PriceHistory)
    private readonly priceHistoryRepository: Repository<PriceHistory>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async refreshHistoricalPriceCaches(
    lookbackHours = this.defaultLookbackHours,
  ): Promise<HistoricalPriceRefreshSummary> {
    const assetPairs = await this.resolveAssetPairs();
    const results: HistoricalPriceRefreshResult[] = [];

    for (const assetPair of assetPairs) {
      results.push(await this.refreshAssetPair(assetPair, lookbackHours));
    }

    return {
      lookbackHours,
      refreshedAt: new Date().toISOString(),
      results,
    };
  }

  async refreshAssetPair(
    assetPair: string,
    lookbackHours = this.defaultLookbackHours,
  ): Promise<HistoricalPriceRefreshResult> {
    const cached = await readHistoricalPriceCache(this.cacheManager, assetPair, lookbackHours);
    if (cached && cached.length > 0) {
      this.logger.debug(`Historical price cache already warm for ${assetPair} (${lookbackHours}h)`);
    }

    let lastError: string | undefined;
    let attempts = 0;

    while (attempts < this.maxAttempts) {
      attempts++;
      try {
        const history = await this.loadHistoricalPrices(assetPair, lookbackHours);
        await writeHistoricalPriceCache(
          this.cacheManager,
          assetPair,
          lookbackHours,
          history,
        );

        return {
          assetPair,
          refreshed: true,
          attempts,
          cachedRows: history.length,
        };
      } catch (error) {
        lastError = (error as Error).message;
        this.logger.warn(
          `Historical price refresh failed for ${assetPair} (attempt ${attempts}/${this.maxAttempts}): ${lastError}`,
        );

        if (attempts < this.maxAttempts) {
          await this.backoff(attempts);
        }
      }
    }

    return {
      assetPair,
      refreshed: false,
      attempts,
      cachedRows: 0,
      error: lastError,
    };
  }

  async primeHistoricalPriceCache(
    assetPair: string,
    lookbackHours = this.defaultLookbackHours,
  ): Promise<PriceHistory[]> {
    const cached = await readHistoricalPriceCache(this.cacheManager, assetPair, lookbackHours);
    if (cached) {
      return cached;
    }

    const history = await this.loadHistoricalPrices(assetPair, lookbackHours);
    await writeHistoricalPriceCache(
      this.cacheManager,
      assetPair,
      lookbackHours,
      history,
    );
    return history;
  }

  private async resolveAssetPairs(): Promise<string[]> {
    const rows = await this.priceHistoryRepository
      .createQueryBuilder('price')
      .select('DISTINCT price.assetPair', 'assetPair')
      .orderBy('price.assetPair', 'ASC')
      .getRawMany<{ assetPair: string }>();

    const assetPairs = rows.map((row) => row.assetPair).filter(Boolean);
    return assetPairs.length > 0 ? assetPairs : ['XLM-USDC', 'BTC-USDC', 'ETH-USDC'];
  }

  private async loadHistoricalPrices(
    assetPair: string,
    lookbackHours: number,
  ): Promise<PriceHistory[]> {
    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    return this.priceHistoryRepository.find({
      where: {
        assetPair,
      },
      order: {
        timestamp: 'DESC',
      },
    }).then((rows) =>
      rows.filter((row) => new Date(row.timestamp).getTime() >= since.getTime()),
    );
  }

  private async backoff(attempt: number): Promise<void> {
    const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
