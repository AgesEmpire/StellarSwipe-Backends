import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { BaseDexAdapter } from './base-dex.adapter';
import {
  AssetPair,
  DexQuote,
  LiquidityPoolInfo,
  OrderBook,
  OrderBookEntry,
} from '../interfaces/dex-adapter.interface';
import { QuoteRequest } from '../interfaces/quote-request.interface';

@Injectable()
export class StellarTermDexAdapter extends BaseDexAdapter {
  readonly dexName = 'StellarTerm';
  readonly dexId = 'stellarterm';

  private readonly baseUrl: string;
  private readonly tickerUrl: string;
  private readonly horizonUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super();
    this.baseUrl =
      this.configService.get('STELLARTERM_API_URL') ||
      'https://stellarterm.com/api';
    this.tickerUrl =
      this.configService.get('STELLARTERM_TICKER_URL') ||
      'https://ticker.stellar.org';
    this.horizonUrl =
      this.configService.get('STELLAR_HORIZON_URL') ||
      'https://horizon.stellar.org';
  }

  async getQuote(request: QuoteRequest): Promise<DexQuote> {
    return this.withRetry(async () => {
      // StellarTerm focuses on SDEX order book trading
      // Simulate a path-find using Horizon with SDEX preferences
      const isSourceBased = !!request.sourceAmount;
      const endpoint = isSourceBased
        ? `${this.horizonUrl}/paths/strict-send`
        : `${this.horizonUrl}/paths/strict-receive`;

      const params: Record<string, string> = {};

      if (isSourceBased) {
        params.source_amount = request.sourceAmount;
        params.source_asset_type = request.sourceAsset.type;
        if (request.sourceAsset.type !== 'native') {
          params.source_asset_code = request.sourceAsset.code;
          params.source_asset_issuer = request.sourceAsset.issuer;
        }
        params.destination_asset_type = request.destinationAsset.type;
        if (request.destinationAsset.type !== 'native') {
          params.destination_asset_code = request.destinationAsset.code;
          params.destination_asset_issuer = request.destinationAsset.issuer;
        }
      } else {
        params.destination_amount = request.destinationAmount;
        params.destination_asset_type = request.destinationAsset.type;
        if (request.destinationAsset.type !== 'native') {
          params.destination_asset_code = request.destinationAsset.code;
          params.destination_asset_issuer = request.destinationAsset.issuer;
        }
        params.source_asset_type = request.sourceAsset.type;
        if (request.sourceAsset.type !== 'native') {
          params.source_asset_code = request.sourceAsset.code;
          params.source_asset_issuer = request.sourceAsset.issuer;
        }
      }

      const { data } = await firstValueFrom(
        this.httpService.get(endpoint, { params }),
      );

      if (!data._embedded?.records?.length) {
        throw new HttpException(
          `No route available on ${this.dexName}`,
          HttpStatus.NOT_FOUND,
        );
      }

      // StellarTerm prefers SDEX (order book) paths over AMM
      const records = data._embedded.records;
      const sdexPaths = records.filter(
        (r) => !r.path?.some((p) => p.asset_type === 'pool_share'),
      );
      const preferred = sdexPaths.length > 0 ? sdexPaths : records;
      const best = preferred.reduce((a, b) =>
        parseFloat(b.destination_amount) > parseFloat(a.destination_amount)
          ? b
          : a,
      );

      const src = parseFloat(best.source_amount);
      const dst = parseFloat(best.destination_amount);
      const price = dst / src;

      // Retrieve live ticker price for confidence scoring
      const tickerPrice = await this.getTickerPrice(
        request.sourceAsset,
        request.destinationAsset,
      );
      const confidence = tickerPrice
        ? Math.max(0, 1 - Math.abs(price - tickerPrice) / tickerPrice)
        : 0.8;

      return {
        dexId: this.dexId,
        dexName: this.dexName,
        sourceAmount: best.source_amount,
        destinationAmount: best.destination_amount,
        price,
        priceInverse: 1 / price,
        fee: 0.003, // Standard Stellar protocol fee
        feeAsset: request.sourceAsset,
        path: (best.path || []).map((p) =>
          this.parseAssetString(
            p.asset_type === 'native'
              ? 'native'
              : `${p.asset_code}:${p.asset_issuer}`,
          ),
        ),
        estimatedSlippage: request.slippageTolerance || 0.5,
        confidence: Math.min(confidence, 0.95),
        timestamp: new Date(),
        expiresAt: this.buildQuoteExpiry(15), // StellarTerm quotes expire faster
      };
    });
  }

  async getLiquidityPools(assetPair: AssetPair): Promise<LiquidityPoolInfo[]> {
    return this.withRetry(async () => {
      // StellarTerm ticker provides market data
      const baseCode = assetPair.baseAsset.code;
      const counterCode = assetPair.counterAsset.code;

      const { data } = await firstValueFrom(
        this.httpService.get(`${this.tickerUrl}/v2/markets`),
      ).catch(() =>
        firstValueFrom(
          this.httpService.get(`${this.horizonUrl}/liquidity_pools`, {
            params: { limit: 10 },
          }),
        ),
      );

      const markets = data.markets || data._embedded?.records || [];
      const relevant = markets.filter(
        (m) =>
          (m.base_asset === baseCode || m.base_asset_code === baseCode) &&
          (m.counter_asset === counterCode ||
            m.counter_asset_code === counterCode),
      );

      return relevant.slice(0, 5).map((m, idx) => ({
        poolId: m.id || `stellarterm-${baseCode}-${counterCode}-${idx}`,
        dexId: this.dexId,
        assets: [assetPair.baseAsset, assetPair.counterAsset],
        totalValueLocked: parseFloat(m.base_volume || '0'),
        volume24h: parseFloat(m.volume || m.base_volume || '0'),
        fee: 0.003,
        reserveA: m.base_amount || '0',
        reserveB: m.counter_amount || '0',
      }));
    });
  }

  async getOrderBook(assetPair: AssetPair): Promise<OrderBook> {
    return this.withRetry(async () => {
      const params: Record<string, string> = {
        selling_asset_type: assetPair.baseAsset.type,
        buying_asset_type: assetPair.counterAsset.type,
        limit: '20',
      };

      if (assetPair.baseAsset.type !== 'native') {
        params.selling_asset_code = assetPair.baseAsset.code;
        params.selling_asset_issuer = assetPair.baseAsset.issuer;
      }
      if (assetPair.counterAsset.type !== 'native') {
        params.buying_asset_code = assetPair.counterAsset.code;
        params.buying_asset_issuer = assetPair.counterAsset.issuer;
      }

      const { data } = await firstValueFrom(
        this.httpService.get(`${this.horizonUrl}/order_book`, { params }),
      );

      const toEntry = (e: any): OrderBookEntry => ({
        price: e.price,
        amount: e.amount,
        total: (parseFloat(e.price) * parseFloat(e.amount)).toFixed(7),
      });

      const bids = (data.bids || []).map(toEntry);
      const asks = (data.asks || []).map(toEntry);
      const bestBid = bids[0] ? parseFloat(bids[0].price) : 0;
      const bestAsk = asks[0] ? parseFloat(asks[0].price) : 0;

      return {
        dexId: this.dexId,
        bids,
        asks,
        spread: bestAsk > 0 ? ((bestAsk - bestBid) / bestAsk) * 100 : 0,
        midPrice: (bestBid + bestAsk) / 2,
      };
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      const { status } = await firstValueFrom(
        this.httpService.get(`${this.tickerUrl}/v2/assets`),
      ).catch(() => firstValueFrom(this.httpService.get(`${this.horizonUrl}/`)));
      return status === 200;
    } catch {
      return false;
    }
  }

  private async getTickerPrice(
    sourceAsset: any,
    destAsset: any,
  ): Promise<number | null> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(`${this.tickerUrl}/v2/markets`),
      );
      const pair = `${sourceAsset.code}_${destAsset.code}`;
      const market = (data.markets || []).find(
        (m) => m.id === pair || m.trading_pair_name === pair,
      );
      return market ? parseFloat(market.price) : null;
    } catch {
      return null;
    }
  }
}
