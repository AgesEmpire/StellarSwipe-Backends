import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inject, CACHE_MANAGER } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MarketSnapshot } from './entities/market-snapshot.entity';
import { SdexPriceProvider } from '../prices/providers/sdex-price.provider';
import { CoinGeckoPriceProvider } from '../prices/providers/coingecko-price.provider';
import { PriceOracleService } from '../prices/price-oracle.service';

export interface MarketDataPayload {
  assetPair: string;
  baseAsset: string;
  counterAsset: string;
  price: number;
  liquidity: number;
  orderBookBids: OrderBookLevel[];
  orderBookAsks: OrderBookLevel[];
  volume24h: number;
  timestamp: Date;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
  totalValue: number;
}

/**
 * #533 — Market Data Ingestion Pipeline Service
 *
 * This service ingests market prices, liquidity, and order book snapshots
 * for supported Stellar asset pairs. It periodically fetches data from
 * multiple sources (SDEX, price oracles) and stores recent snapshots
 * in the database for use by trading engines and feed systems.
 *
 * Key Features:
 * - Periodic price and liquidity data ingestion
 * - Data normalization for feed and execution use
 * - Failure retry and logging without blocking backend
 * - Cache-based recent snapshot storage
 * - Event emission for subscribers
 */
@Injectable()
export class MarketDataIngestionService implements OnModuleInit {
  private readonly logger = new Logger(MarketDataIngestionService.name);
  private readonly CACHE_TTL = 300000; // 5 minutes
  private ingestingAssets: Set<string> = new Set();
  private retryAttempts = 3;
  private retryDelayMs = 1000;

  // Supported asset pairs for ingestion
  private readonly SUPPORTED_ASSETS = [
    'XLM/USD',
    'BTC/USD',
    'ETH/USD',
    'XLM/EUR',
    'BTC/XLM',
    'ETH/XLM',
  ];

  constructor(
    @InjectRepository(MarketSnapshot)
    private marketSnapshotRepository: Repository<MarketSnapshot>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    private priceOracleService: PriceOracleService,
    private sdexPriceProvider: SdexPriceProvider,
    private coingeckoProvider: CoinGeckoPriceProvider,
    private eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Market Data Ingestion Service initialized');
  }

  /**
   * Ingest market data for a specific asset pair.
   * Fetches from multiple sources and stores in database.
   */
  async ingestMarketData(assetPair: string): Promise<MarketDataPayload | null> {
    // Prevent concurrent ingestion of the same asset
    if (this.ingestingAssets.has(assetPair)) {
      this.logger.debug(`Ingestion already in progress for ${assetPair}`);
      return null;
    }

    this.ingestingAssets.add(assetPair);

    try {
      const [baseAsset, counterAsset] = assetPair.split('/');

      let marketData: MarketDataPayload | null = null;

      // Try SDEX first (Stellar DEX)
      try {
        marketData = await this.fetchFromSDEX(baseAsset, counterAsset);
      } catch (error) {
        this.logger.warn(
          `Failed to fetch from SDEX for ${assetPair}: ${(error as Error).message}`,
        );
      }

      // Fallback to CoinGecko if SDEX fails
      if (!marketData) {
        try {
          marketData = await this.fetchFromCoinGecko(baseAsset, counterAsset);
        } catch (error) {
          this.logger.warn(
            `Failed to fetch from CoinGecko for ${assetPair}: ${(error as Error).message}`,
          );
        }
      }

      if (!marketData) {
        this.logger.error(
          `Failed to ingest market data for ${assetPair} from all sources`,
        );
        this.eventEmitter.emit('market.ingestion.failed', {
          assetPair,
          timestamp: new Date(),
        });
        return null;
      }

      // Store snapshot in database
      await this.storeMarketSnapshot(marketData);

      // Cache the data for quick access
      await this.cacheManager.set(
        `market:${assetPair}:snapshot`,
        marketData,
        this.CACHE_TTL,
      );

      // Emit event for subscribers
      this.eventEmitter.emit('market.data.ingested', {
        assetPair,
        price: marketData.price,
        liquidity: marketData.liquidity,
        timestamp: marketData.timestamp,
      });

      this.logger.log(
        `Market data ingested for ${assetPair}: price=${marketData.price.toFixed(8)}, liquidity=${marketData.liquidity.toFixed(2)}`,
      );

      return marketData;
    } catch (error) {
      this.logger.error(
        `Unexpected error during market data ingestion for ${assetPair}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      this.eventEmitter.emit('market.ingestion.error', {
        assetPair,
        error: (error as Error).message,
        timestamp: new Date(),
      });
      return null;
    } finally {
      this.ingestingAssets.delete(assetPair);
    }
  }

  /**
   * Ingest market data for all supported asset pairs.
   * This is called periodically by the scheduled job.
   */
  async ingestAllMarketData(): Promise<Map<string, MarketDataPayload | null>> {
    const results = new Map<string, MarketDataPayload | null>();

    this.logger.log(
      `Starting bulk market data ingestion for ${this.SUPPORTED_ASSETS.length} asset pairs`,
    );

    const startTime = Date.now();

    // Ingest in parallel with concurrency control
    const concurrency = 3;
    for (let i = 0; i < this.SUPPORTED_ASSETS.length; i += concurrency) {
      const batch = this.SUPPORTED_ASSETS.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map((asset) => this.ingestMarketData(asset)),
      );

      batchResults.forEach((result, index) => {
        const assetPair = batch[index];
        if (result.status === 'fulfilled') {
          results.set(assetPair, result.value);
        } else {
          this.logger.error(
            `Ingestion failed for ${assetPair}: ${result.reason}`,
          );
          results.set(assetPair, null);
        }
      });
    }

    const duration = Date.now() - startTime;
    const successCount = Array.from(results.values()).filter((v) => v !== null)
      .length;

    this.logger.log(
      `Bulk market data ingestion completed in ${duration}ms: ${successCount}/${this.SUPPORTED_ASSETS.length} successful`,
    );

    this.eventEmitter.emit('market.ingestion.completed', {
      totalAssets: this.SUPPORTED_ASSETS.length,
      successCount,
      duration,
      timestamp: new Date(),
    });

    return results;
  }

  /**
   * Fetch market data from Stellar DEX (SDEX).
   */
  private async fetchFromSDEX(
    baseAsset: string,
    counterAsset: string,
  ): Promise<MarketDataPayload> {
    const assetPair = `${baseAsset}/${counterAsset}`;

    // Retry logic for transient failures
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const priceData = await this.sdexPriceProvider.getPrice(assetPair);

        // Fetch order book data
        const orderBook = await this.sdexPriceProvider.getOrderBook?.(assetPair);

        return {
          assetPair,
          baseAsset,
          counterAsset,
          price: parseFloat(priceData.price),
          liquidity: parseFloat(priceData.liquidity || '0'),
          orderBookBids: orderBook?.bids || [],
          orderBookAsks: orderBook?.asks || [],
          volume24h: parseFloat(priceData.volume24h || '0'),
          timestamp: new Date(),
        };
      } catch (error) {
        if (attempt < this.retryAttempts) {
          const delayMs = this.retryDelayMs * attempt;
          this.logger.debug(
            `SDEX fetch attempt ${attempt} failed, retrying in ${delayMs}ms: ${(error as Error).message}`,
          );
          await this.delay(delayMs);
        } else {
          throw error;
        }
      }
    }

    throw new Error('Max retry attempts exceeded for SDEX fetch');
  }

  /**
   * Fetch market data from CoinGecko price oracle (fallback).
   */
  private async fetchFromCoinGecko(
    baseAsset: string,
    counterAsset: string,
  ): Promise<MarketDataPayload> {
    const assetPair = `${baseAsset}/${counterAsset}`;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const priceData = await this.coingeckoProvider.getPrice(assetPair);

        return {
          assetPair,
          baseAsset,
          counterAsset,
          price: parseFloat(priceData.price),
          liquidity: 0, // CoinGecko doesn't provide liquidity data
          orderBookBids: [],
          orderBookAsks: [],
          volume24h: parseFloat(priceData.volume24h || '0'),
          timestamp: new Date(),
        };
      } catch (error) {
        if (attempt < this.retryAttempts) {
          const delayMs = this.retryDelayMs * attempt;
          this.logger.debug(
            `CoinGecko fetch attempt ${attempt} failed, retrying in ${delayMs}ms: ${(error as Error).message}`,
          );
          await this.delay(delayMs);
        } else {
          throw error;
        }
      }
    }

    throw new Error('Max retry attempts exceeded for CoinGecko fetch');
  }

  /**
   * Store market snapshot in the database.
   */
  private async storeMarketSnapshot(data: MarketDataPayload): Promise<void> {
    try {
      const snapshot = this.marketSnapshotRepository.create({
        assetPair: data.assetPair,
        baseAsset: data.baseAsset,
        counterAsset: data.counterAsset,
        price: data.price.toString(),
        liquidity: data.liquidity.toString(),
        volume24h: data.volume24h.toString(),
        orderBookSnapshot: {
          bids: data.orderBookBids,
          asks: data.orderBookAsks,
        },
        capturedAt: data.timestamp,
      });

      await this.marketSnapshotRepository.save(snapshot);
    } catch (error) {
      this.logger.error(
        `Failed to store market snapshot for ${data.assetPair}: ${(error as Error).message}`,
      );
      // Don't throw — this shouldn't block the ingestion pipeline
    }
  }

  /**
   * Get the most recent market snapshot for an asset pair from cache or database.
   */
  async getLatestSnapshot(assetPair: string): Promise<MarketDataPayload | null> {
    // Try cache first
    const cached = await this.cacheManager.get<MarketDataPayload>(
      `market:${assetPair}:snapshot`,
    );
    if (cached) {
      return cached;
    }

    // Fall back to database
    try {
      const [baseAsset, counterAsset] = assetPair.split('/');
      const snapshot = await this.marketSnapshotRepository.findOne({
        where: {
          baseAsset,
          counterAsset,
        },
        order: {
          capturedAt: 'DESC',
        },
      });

      if (snapshot) {
        const payload: MarketDataPayload = {
          assetPair,
          baseAsset,
          counterAsset,
          price: parseFloat(snapshot.price),
          liquidity: parseFloat(snapshot.liquidity),
          orderBookBids: snapshot.orderBookSnapshot?.bids || [],
          orderBookAsks: snapshot.orderBookSnapshot?.asks || [],
          volume24h: parseFloat(snapshot.volume24h),
          timestamp: snapshot.capturedAt,
        };

        // Re-cache it
        await this.cacheManager.set(
          `market:${assetPair}:snapshot`,
          payload,
          this.CACHE_TTL,
        );

        return payload;
      }
    } catch (error) {
      this.logger.error(
        `Error retrieving market snapshot for ${assetPair}: ${(error as Error).message}`,
      );
    }

    return null;
  }

  /**
   * Get all supported asset pairs.
   */
  getSupportedAssets(): string[] {
    return this.SUPPORTED_ASSETS;
  }

  /**
   * Add a new asset pair to ingestion (runtime).
   */
  addSupportedAsset(assetPair: string): void {
    if (!this.SUPPORTED_ASSETS.includes(assetPair)) {
      this.SUPPORTED_ASSETS.push(assetPair);
      this.logger.log(`Added asset ${assetPair} to supported assets`);
    }
  }

  /**
   * Get ingestion metrics and health.
   */
  getIngestionMetrics(): {
    supportedAssets: number;
    currentlyIngesting: number;
    lastCompletedAt?: Date;
  } {
    return {
      supportedAssets: this.SUPPORTED_ASSETS.length,
      currentlyIngesting: this.ingestingAssets.size,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
