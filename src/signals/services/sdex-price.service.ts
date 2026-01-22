import { Injectable, Logger } from '@nestjs/common';
import { StellarConfigService } from '../../config/stellar.service';
import * as StellarSdk from '@stellar/stellar-sdk';

export interface PriceResult {
  price: string;
  available: boolean;
  source: string;
  timestamp: Date;
  error?: string;
}

export interface AssetPair {
  baseAsset: string;
  counterAsset: string;
}

@Injectable()
export class SdexPriceService {
  private readonly logger = new Logger(SdexPriceService.name);
  private server: StellarSdk.Horizon.Server;

  constructor(private stellarConfig: StellarConfigService) {
    this.server = new StellarSdk.Horizon.Server(this.stellarConfig.horizonUrl);
  }

  async getPrice(baseAsset: string, counterAsset: string): Promise<PriceResult> {
    try {
      const base = this.parseAsset(baseAsset);
      const counter = this.parseAsset(counterAsset);

      const orderbook = await this.server
        .orderbook(base, counter)
        .limit(1)
        .call();

      if (orderbook.bids.length === 0 && orderbook.asks.length === 0) {
        return {
          price: '0',
          available: false,
          source: 'sdex',
          timestamp: new Date(),
          error: 'No orders available for this trading pair',
        };
      }

      let price: string;
      if (orderbook.bids.length > 0 && orderbook.asks.length > 0) {
        const bid = parseFloat(orderbook.bids[0].price);
        const ask = parseFloat(orderbook.asks[0].price);
        price = ((bid + ask) / 2).toFixed(8);
      } else if (orderbook.bids.length > 0) {
        price = orderbook.bids[0].price;
      } else {
        price = orderbook.asks[0].price;
      }

      return {
        price,
        available: true,
        source: 'sdex',
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch price for ${baseAsset}/${counterAsset}: ${error}`,
      );
      return {
        price: '0',
        available: false,
        source: 'sdex',
        timestamp: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getPrices(pairs: AssetPair[]): Promise<Map<string, PriceResult>> {
    const results = new Map<string, PriceResult>();

    const pricePromises = pairs.map(async (pair) => {
      const key = `${pair.baseAsset}/${pair.counterAsset}`;
      const result = await this.getPrice(pair.baseAsset, pair.counterAsset);
      return { key, result };
    });

    const priceResults = await Promise.allSettled(pricePromises);

    for (const result of priceResults) {
      if (result.status === 'fulfilled') {
        results.set(result.value.key, result.value.result);
      }
    }

    return results;
  }

  async getTradeAggregations(
    baseAsset: string,
    counterAsset: string,
    resolution: number = 300000,
    limit: number = 10,
  ): Promise<{ timestamp: string; avg: string; high: string; low: string; close: string }[]> {
    try {
      const base = this.parseAsset(baseAsset);
      const counter = this.parseAsset(counterAsset);

      const startTime = Date.now() - resolution * limit;
      const endTime = Date.now();

      const aggregations = await this.server
        .tradeAggregation(base, counter, startTime, endTime, resolution, 0)
        .limit(limit)
        .call();

      return aggregations.records.map((record) => ({
        timestamp: String(record.timestamp),
        avg: record.avg,
        high: record.high,
        low: record.low,
        close: record.close,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to fetch trade aggregations for ${baseAsset}/${counterAsset}: ${error}`,
      );
      return [];
    }
  }

  private parseAsset(assetString: string): StellarSdk.Asset {
    if (assetString === 'native' || assetString === 'XLM') {
      return StellarSdk.Asset.native();
    }

    const parts = assetString.split(':');
    if (parts.length !== 2) {
      throw new Error(`Invalid asset format: ${assetString}. Expected 'CODE:ISSUER' or 'native'`);
    }

    return new StellarSdk.Asset(parts[0], parts[1]);
  }

  calculatePnlPercentage(entryPrice: string, currentPrice: string): string {
    const entry = parseFloat(entryPrice);
    const current = parseFloat(currentPrice);

    if (entry === 0) return '0';

    const pnl = ((current - entry) / entry) * 100;
    return pnl.toFixed(4);
  }

  calculatePnlAbsolute(entryPrice: string, currentPrice: string, volume: string = '1'): string {
    const entry = parseFloat(entryPrice);
    const current = parseFloat(currentPrice);
    const vol = parseFloat(volume);

    const pnl = (current - entry) * vol;
    return pnl.toFixed(8);
  }

  calculateDistanceToTarget(currentPrice: string, targetPrice: string, entryPrice: string): string {
    const current = parseFloat(currentPrice);
    const target = parseFloat(targetPrice);
    const entry = parseFloat(entryPrice);

    if (entry === 0) return '0';

    const totalDistance = Math.abs(target - entry);
    const currentDistance = Math.abs(target - current);

    if (totalDistance === 0) return '100';

    const progress = ((totalDistance - currentDistance) / totalDistance) * 100;
    return Math.max(0, Math.min(100, progress)).toFixed(4);
  }

  calculateDistanceToStopLoss(
    currentPrice: string,
    stopLossPrice: string,
    entryPrice: string,
  ): string {
    const current = parseFloat(currentPrice);
    const stopLoss = parseFloat(stopLossPrice);
    const entry = parseFloat(entryPrice);

    if (entry === 0) return '0';

    const totalDistance = Math.abs(entry - stopLoss);
    const currentDistance = Math.abs(current - stopLoss);

    if (totalDistance === 0) return '0';

    const distancePercentage = (currentDistance / totalDistance) * 100;
    return distancePercentage.toFixed(4);
  }

  isTargetHit(currentPrice: string, targetPrice: string, signalType: 'buy' | 'sell'): boolean {
    const current = parseFloat(currentPrice);
    const target = parseFloat(targetPrice);

    if (signalType === 'buy') {
      return current >= target;
    } else {
      return current <= target;
    }
  }

  isStopLossHit(currentPrice: string, stopLossPrice: string, signalType: 'buy' | 'sell'): boolean {
    const current = parseFloat(currentPrice);
    const stopLoss = parseFloat(stopLossPrice);

    if (signalType === 'buy') {
      return current <= stopLoss;
    } else {
      return current >= stopLoss;
    }
  }
}
