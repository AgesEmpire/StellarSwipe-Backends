import { Injectable } from '@nestjs/common';
import { BaseCacheStrategy } from './base-cache.strategy';

interface PortfolioData {
  userId: string;
  totalValue: string;
  positions: any[];
  updatedAt: Date;
}

interface OrderbookSnapshot {
  baseAsset: string;
  counterAsset: string;
  bids: Array<{ price: string; amount: string }>;
  asks: Array<{ price: string; amount: string }>;
  timestamp: Date;
}

@Injectable()
export class PortfolioCacheStrategy extends BaseCacheStrategy {
  private readonly TTL = {
    portfolio: 120,      // 2 minutes — balances change moderately
    portfolioSummary: 60, // 1 minute for summary/stats
    orderbook: 10,        // 10 seconds — orderbook is very volatile
  };

  // ── Portfolio ──────────────────────────────────────────────────────────────

  async getPortfolio(userId: string): Promise<PortfolioData | null> {
    const key = `portfolio:${userId}`;
    return this.get<PortfolioData>(key, { ttl: this.TTL.portfolio, useL1: true });
  }

  async setPortfolio(userId: string, data: PortfolioData): Promise<void> {
    const key = `portfolio:${userId}`;
    await this.set(key, data, { ttl: this.TTL.portfolio, useL1: true });
  }

  async invalidatePortfolio(userId: string): Promise<void> {
    await this.delete(`portfolio:${userId}`);
    await this.delete(`portfolio:${userId}:summary`);
  }

  async getPortfolioSummary(userId: string): Promise<any | null> {
    const key = `portfolio:${userId}:summary`;
    return this.get(key, { ttl: this.TTL.portfolioSummary, useL1: true });
  }

  async setPortfolioSummary(userId: string, data: any): Promise<void> {
    const key = `portfolio:${userId}:summary`;
    await this.set(key, data, { ttl: this.TTL.portfolioSummary, useL1: true });
  }

  // ── Orderbook ──────────────────────────────────────────────────────────────

  async getOrderbook(baseAsset: string, counterAsset: string): Promise<OrderbookSnapshot | null> {
    const key = `orderbook:${baseAsset}:${counterAsset}`;
    return this.get<OrderbookSnapshot>(key, { ttl: this.TTL.orderbook, useL1: false });
  }

  async setOrderbook(baseAsset: string, counterAsset: string, data: OrderbookSnapshot): Promise<void> {
    const key = `orderbook:${baseAsset}:${counterAsset}`;
    await this.set(key, data, { ttl: this.TTL.orderbook, useL1: false });
  }

  async invalidateOrderbook(baseAsset: string, counterAsset: string): Promise<void> {
    await this.delete(`orderbook:${baseAsset}:${counterAsset}`);
  }

  async invalidateAllOrderbooks(): Promise<void> {
    await this.deletePattern('orderbook:*');
  }

  // ── Cache-aside helpers ────────────────────────────────────────────────────

  async getOrFetchPortfolio(
    userId: string,
    fetchFn: () => Promise<PortfolioData>,
  ): Promise<PortfolioData> {
    const key = `portfolio:${userId}`;
    return this.getOrSet(key, fetchFn, { ttl: this.TTL.portfolio, useL1: true });
  }

  async getOrFetchOrderbook(
    baseAsset: string,
    counterAsset: string,
    fetchFn: () => Promise<OrderbookSnapshot>,
  ): Promise<OrderbookSnapshot> {
    const key = `orderbook:${baseAsset}:${counterAsset}`;
    return this.getOrSet(key, fetchFn, { ttl: this.TTL.orderbook, useL1: false });
  }
}
