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
export class StellarxDexAdapter extends BaseDexAdapter {
  readonly dexName = 'StellarX';
  readonly dexId = 'stellarx';

  private readonly baseUrl: string;
  private readonly horizonUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super();
    this.baseUrl =
      this.configService.get('STELLARX_API_URL') ||
      'https://api.stellarx.com/api';
    this.horizonUrl =
      this.configService.get('STELLAR_HORIZON_URL') ||
      'https://horizon.stellar.org';
  }

  async getQuote(request: QuoteRequest): Promise<DexQuote> {
    return this.withRetry(async () => {
      // StellarX uses Stellar DEX (SDEX) + AMM pools
      // Try strict-receive for destination-amount-first routing
      const params: Record<string, string> = {
        destination_asset_type: request.destinationAsset.type,
        destination_amount: request.destinationAmount || '0',
        source_asset_type: request.sourceAsset.type,
      };

      if (request.destinationAsset.type !== 'native') {
        params.destination_asset_code = request.destinationAsset.code;
        params.destination_asset_issuer = request.destinationAsset.issuer;
      }
      if (request.sourceAsset.type !== 'native') {
        params.source_asset_code = request.sourceAsset.code;
        params.source_asset_issuer = request.sourceAsset.issuer;
      }

      // Use source-amount if provided, switch endpoint
      let endpoint = `${this.horizonUrl}/paths/strict-receive`;
      if (request.sourceAmount && !request.destinationAmount) {
        endpoint = `${this.horizonUrl}/paths/strict-send`;
        delete params.destination_amount;
        params.source_amount = request.sourceAmount;
      }

      const { data } = await firstValueFrom(
        this.httpService.get(endpoint, { params }),
      );

      if (!data._embedded?.records?.length) {
        throw new HttpException(
          `No liquidity found on ${this.dexName}`,
          HttpStatus.NOT_FOUND,
        );
      }

      // StellarX prefers AMM paths — prioritize those
      const records = data._embedded.records;
      const ammPaths = records.filter((r) =>
        r.path?.some((p) => p.asset_type === 'pool_share'),
      );
      const bestRecord =
        ammPaths.length > 0
          ? ammPaths.reduce((best, cur) =>
              parseFloat(cur.destination_amount) >
              parseFloat(best.destination_amount)
                ? cur
                : best,
            )
          : records[0];

      const srcAmount = parseFloat(bestRecord.source_amount);
      const dstAmount = parseFloat(bestRecord.destination_amount);
      const price = dstAmount / srcAmount;

      // StellarX charges 0.1% platform fee on top of protocol fees
      const platformFee = 0.001;
      const protocolFee = 0.003;

      return {
        dexId: this.dexId,
        dexName: this.dexName,
        sourceAmount: bestRecord.source_amount,
        destinationAmount: bestRecord.destination_amount,
        price,
        priceInverse: 1 / price,
        fee: platformFee + protocolFee,
        feeAsset: request.sourceAsset,
        path: (bestRecord.path || []).map((p) =>
          this.parseAssetString(
            p.asset_type === 'native'
              ? 'native'
              : `${p.asset_code}:${p.asset_issuer}`,
          ),
        ),
        estimatedSlippage:
          request.slippageTolerance || this.estimateSlippage(records),
        confidence: ammPaths.length > 0 ? 0.85 : 0.75,
        timestamp: new Date(),
        expiresAt: this.buildQuoteExpiry(20),
      };
    });
  }

  async getLiquidityPools(assetPair: AssetPair): Promise<LiquidityPoolInfo[]> {
    return this.withRetry(async () => {
      // StellarX exposes AMM pool statistics
      const { data } = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/markets`, {
          params: {
            base_asset: this.formatAsset(assetPair.baseAsset),
            counter_asset: this.formatAsset(assetPair.counterAsset),
          },
        }),
      ).catch(async () => {
        // Fallback to Horizon liquidity pools
        return firstValueFrom(
          this.httpService.get(`${this.horizonUrl}/liquidity_pools`, {
            params: { limit: 20 },
          }),
        );
      });

      const records = data._embedded?.records || data.markets || [];
      return records.slice(0, 10).map((pool, idx) => ({
        poolId: pool.id || pool.pool_id || `stellarx-pool-${idx}`,
        dexId: this.dexId,
        assets: [assetPair.baseAsset, assetPair.counterAsset],
        totalValueLocked: parseFloat(pool.total_value_locked || pool.volume || '0'),
        volume24h: parseFloat(pool.volume_24h || pool.base_volume || '0'),
        fee: parseFloat(pool.fee || pool.fee_bp || '30') / 10000,
        reserveA: pool.base_amount || pool.reserves?.[0]?.amount || '0',
        reserveB: pool.counter_amount || pool.reserves?.[1]?.amount || '0',
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

      const mapEntries = (entries: any[]): OrderBookEntry[] =>
        (entries || []).map((e) => ({
          price: e.price,
          amount: e.amount,
          total: (parseFloat(e.price) * parseFloat(e.amount)).toFixed(7),
        }));

      const bids = mapEntries(data.bids);
      const asks = mapEntries(data.asks);
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
        this.httpService.get(`${this.baseUrl}/health`),
      ).catch(() => firstValueFrom(this.httpService.get(`${this.horizonUrl}/`)));
      return status === 200;
    } catch {
      return false;
    }
  }

  private estimateSlippage(records: any[]): number {
    if (records.length < 2) return 0;
    const best = parseFloat(records[0].destination_amount);
    const second = parseFloat(records[1].destination_amount);
    return Math.abs((best - second) / best) * 100;
  }
}
