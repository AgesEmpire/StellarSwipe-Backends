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
export class LobstrDexAdapter extends BaseDexAdapter {
  readonly dexName = 'Lobstr';
  readonly dexId = 'lobstr';

  private readonly baseUrl: string;
  private readonly stellarHorizonUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super();
    // Lobstr leverages Stellar Horizon + its own liquidity pools
    this.baseUrl =
      this.configService.get('LOBSTR_API_URL') || 'https://api.lobstr.co/v1';
    this.stellarHorizonUrl =
      this.configService.get('STELLAR_HORIZON_URL') ||
      'https://horizon.stellar.org';
  }

  async getQuote(request: QuoteRequest): Promise<DexQuote> {
    return this.withRetry(async () => {
      const sourceAssetStr = this.formatAsset(request.sourceAsset);
      const destAssetStr = this.formatAsset(request.destinationAsset);

      // Use Stellar Horizon's path payment strict send for Lobstr routing
      const params = new URLSearchParams({
        source_asset_type: request.sourceAsset.type,
        ...(request.sourceAsset.type !== 'native' && {
          source_asset_code: request.sourceAsset.code,
          source_asset_issuer: request.sourceAsset.issuer,
        }),
        source_amount: request.sourceAmount || '0',
        destination_asset_type: request.destinationAsset.type,
        ...(request.destinationAsset.type !== 'native' && {
          destination_asset_code: request.destinationAsset.code,
          destination_asset_issuer: request.destinationAsset.issuer,
        }),
      });

      const { data } = await firstValueFrom(
        this.httpService.get(
          `${this.stellarHorizonUrl}/paths/strict-send?${params}`,
        ),
      );

      if (!data._embedded?.records?.length) {
        throw new HttpException(
          `No path found on ${this.dexName}`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Pick the best path by destination amount
      const bestPath = data._embedded.records.reduce((best, current) =>
        parseFloat(current.destination_amount) >
        parseFloat(best.destination_amount)
          ? current
          : best,
      );

      const price =
        parseFloat(bestPath.destination_amount) /
        parseFloat(bestPath.source_amount);

      return {
        dexId: this.dexId,
        dexName: this.dexName,
        sourceAmount: bestPath.source_amount,
        destinationAmount: bestPath.destination_amount,
        price,
        priceInverse: 1 / price,
        fee: 0.003, // Lobstr standard 0.3% fee
        feeAsset: request.sourceAsset,
        path: (bestPath.path || []).map((p) =>
          this.parseAssetString(
            p.asset_type === 'native' ? 'native' : `${p.asset_code}:${p.asset_issuer}`,
          ),
        ),
        estimatedSlippage: this.calculateSlippage(
          request.sourceAmount || '0',
          bestPath.source_amount,
        ),
        confidence: 0.9,
        timestamp: new Date(),
        expiresAt: this.buildQuoteExpiry(30),
      };
    });
  }

  async getLiquidityPools(assetPair: AssetPair): Promise<LiquidityPoolInfo[]> {
    return this.withRetry(async () => {
      const { data } = await firstValueFrom(
        this.httpService.get(`${this.stellarHorizonUrl}/liquidity_pools`, {
          params: {
            reserves:
              `${this.formatAsset(assetPair.baseAsset)},` +
              `${this.formatAsset(assetPair.counterAsset)}`,
            limit: 10,
          },
        }),
      );

      return (data._embedded?.records || []).map((pool) => ({
        poolId: pool.id,
        dexId: this.dexId,
        assets: pool.reserves.map((r) =>
          this.parseAssetString(
            r.asset === 'native' ? 'native' : r.asset,
          ),
        ),
        totalValueLocked: parseFloat(pool.total_trustlines || '0'),
        volume24h: 0, // Horizon doesn't expose this directly
        fee: parseFloat(pool.fee_bp) / 10000,
        reserveA: pool.reserves[0]?.amount || '0',
        reserveB: pool.reserves[1]?.amount || '0',
      }));
    });
  }

  async getOrderBook(assetPair: AssetPair): Promise<OrderBook> {
    return this.withRetry(async () => {
      const base = assetPair.baseAsset;
      const counter = assetPair.counterAsset;

      const params: Record<string, string> = {
        selling_asset_type: base.type,
        buying_asset_type: counter.type,
        limit: '20',
      };

      if (base.type !== 'native') {
        params.selling_asset_code = base.code;
        params.selling_asset_issuer = base.issuer;
      }
      if (counter.type !== 'native') {
        params.buying_asset_code = counter.code;
        params.buying_asset_issuer = counter.issuer;
      }

      const { data } = await firstValueFrom(
        this.httpService.get(`${this.stellarHorizonUrl}/order_book`, { params }),
      );

      const bids: OrderBookEntry[] = (data.bids || []).map((b) => ({
        price: b.price,
        amount: b.amount,
        total: (parseFloat(b.price) * parseFloat(b.amount)).toFixed(7),
      }));

      const asks: OrderBookEntry[] = (data.asks || []).map((a) => ({
        price: a.price,
        amount: a.amount,
        total: (parseFloat(a.price) * parseFloat(a.amount)).toFixed(7),
      }));

      const bestBid = bids[0] ? parseFloat(bids[0].price) : 0;
      const bestAsk = asks[0] ? parseFloat(asks[0].price) : 0;
      const midPrice = (bestBid + bestAsk) / 2;
      const spread = bestAsk > 0 ? ((bestAsk - bestBid) / bestAsk) * 100 : 0;

      return { dexId: this.dexId, bids, asks, spread, midPrice };
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      const { status } = await firstValueFrom(
        this.httpService.get(`${this.stellarHorizonUrl}/`),
      );
      return status === 200;
    } catch {
      return false;
    }
  }
}
