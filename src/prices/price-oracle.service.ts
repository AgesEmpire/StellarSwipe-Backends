import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PriceHistory } from './entities/price-history.entity';
import { PriceDataDto } from './dto/price-data.dto';
import { SdexPriceProvider } from './providers/sdex-price.provider';
import { CoinGeckoPriceProvider } from './providers/coingecko-price.provider';
import { StellarExpertPriceProvider } from './providers/stellar-expert-price.provider';

@Injectable()
export class PriceOracleService implements OnModuleInit {
  private readonly logger = new Logger(PriceOracleService.name);
  private readonly CACHE_TTL = 60000; // 60 seconds
  private readonly MAX_DEVIATION = 0.05; // 5%

  constructor(
    @InjectRepository(PriceHistory)
    private priceHistoryRepository: Repository<PriceHistory>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    private eventEmitter: EventEmitter2,
    private sdexProvider: SdexPriceProvider,
    private coingeckoProvider: CoinGeckoPriceProvider,
    private stellarExpertProvider: StellarExpertPriceProvider,
  ) {}

  async onModuleInit() {
    this.logger.log('Price Oracle Service initialized');
  }

  async getPrice(assetPair: string): Promise<PriceDataDto> {
    const cacheKey = `price:${assetPair}`;
    const cached = await this.cacheManager.get<PriceDataDto>(cacheKey);

    if (cached) {
      this.logger.debug(`Cache hit for ${assetPair}`);
      return cached;
    }

    const priceData = await this.fetchAndAggregatePrice(assetPair);
    await this.cacheManager.set(cacheKey, priceData, this.CACHE_TTL);

    return priceData;
  }

  private async fetchAndAggregatePrice(
    assetPair: string,
  ): Promise<PriceDataDto> {
    const results = await Promise.allSettled([
      this.sdexProvider.getPrice(assetPair),
      this.coingeckoProvider.getPrice(assetPair),
      this.stellarExpertProvider.getPrice(assetPair),
    ]);

    const validPrices = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map((r) => r.value);

    if (validPrices.length === 0) {
      return this.handleAllSourcesFailed(assetPair);
    }

    const prices = validPrices.map((p) => p.price);
    const medianPrice = this.calculateMedian(prices);
    const deviation = this.calculateDeviation(prices);

    if (deviation > this.MAX_DEVIATION) {
      this.logger.warn(
        `High price deviation detected for ${assetPair}: ${deviation * 100}%`,
      );
      this.eventEmitter.emit('price.deviation.high', {
        assetPair,
        deviation,
        prices,
      });
    }

    const priceData: PriceDataDto = {
      assetPair,
      price: medianPrice,
      source: 'aggregated',
      timestamp: new Date(),
      confidence: validPrices.length / 3,
      sourcesUsed: validPrices.map((p) => p.source),
      deviation,
    };

    await this.storePriceHistory(assetPair, medianPrice, validPrices);

    return priceData;
  }

  private async handleAllSourcesFailed(
    assetPair: string,
  ): Promise<PriceDataDto> {
    this.logger.error(`All price sources failed for ${assetPair}`);
    this.eventEmitter.emit('price.sources.failed', { assetPair });

    const lastKnown = await this.priceHistoryRepository.findOne({
      where: { assetPair },
      order: { timestamp: 'DESC' },
    });

    if (!lastKnown) {
      throw new Error(`No price data available for ${assetPair}`);
    }

    this.logger.warn(
      `Using last known price for ${assetPair} from ${lastKnown.timestamp}`,
    );

    return {
      assetPair,
      price: Number(lastKnown.price),
      source: 'fallback',
      timestamp: lastKnown.timestamp,
      confidence: 0,
      sourcesUsed: [lastKnown.source],
    };
  }

  private calculateMedian(prices: number[]): number {
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private calculateDeviation(prices: number[]): number {
    if (prices.length < 2) return 0;
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance =
      prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length;
    return Math.sqrt(variance) / avg;
  }

  private async storePriceHistory(
    assetPair: string,
    medianPrice: number,
    validPrices: any[],
  ) {
    const metadata = {
      sdexPrice: validPrices.find((p) => p.source === 'SDEX')?.price,
      coingeckoPrice: validPrices.find((p) => p.source === 'CoinGecko')?.price,
      stellarExpertPrice: validPrices.find((p) => p.source === 'StellarExpert')
        ?.price,
      pricesUsed: validPrices.map((p) => p.price),
      deviation: this.calculateDeviation(validPrices.map((p) => p.price)),
    };

    const history = this.priceHistoryRepository.create({
      assetPair,
      price: medianPrice,
      source: 'aggregated',
      metadata,
      timestamp: new Date(),
    });

    await this.priceHistoryRepository.save(history);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async captureHourlySnapshots() {
    const commonPairs = ['XLM-USDC', 'BTC-USDC', 'ETH-USDC'];

    for (const pair of commonPairs) {
      try {
        await this.getPrice(pair);
        this.logger.debug(`Hourly snapshot captured for ${pair}`);
      } catch (error) {
        this.logger.error(
          `Failed to capture hourly snapshot for ${pair}: ${error.message}`,
        );
      }
    }
  }

  async getPriceHistory(
    assetPair: string,
    hours: number = 24,
  ): Promise<PriceHistory[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    return this.priceHistoryRepository.find({
      where: { assetPair },
      order: { timestamp: 'DESC' },
    });
  }
}
