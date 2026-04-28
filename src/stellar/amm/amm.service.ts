import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  PoolDiscoveryService,
  LiquidityPool,
  PoolYield,
  StellarAsset,
} from './pool-discovery.service';
import {
  RoutingOptimizerService,
  AmmQuote,
  SdexOrderbookQuote,
  RoutingDecision,
  SplitRoute,
} from './routing-optimizer.service';

export interface SwapQuoteRequest {
  assetIn: StellarAsset;
  assetOut: StellarAsset;
  amountIn: number;
  /** If true, also fetch an SDEX quote and compare. Default: true */
  compareWithSdex?: boolean;
}

export interface SwapQuoteResponse {
  request: SwapQuoteRequest;
  routingDecision: RoutingDecision;
  splitRoute: SplitRoute | null;
  pools: LiquidityPool[];
  fetchedAt: Date;
}

export interface LpPosition {
  poolId: string;
  pool: LiquidityPool;
  lpTokenBalance: string;
  shareOfPool: number;
  estimatedAssetAAmount: number;
  estimatedAssetBAmount: number;
  yieldMetrics: PoolYield | null;
}

@Injectable()
export class AmmService {
  private readonly logger = new Logger(AmmService.name);
  private readonly horizonUrl: string;

  /** In-memory pool cache, refreshed every 10 minutes by cron */
  private poolCache: Map<string, LiquidityPool> = new Map();
  private cacheRefreshedAt: Date | null = null;

  /** Large trade threshold — trades above this fraction of pool reserves
   *  trigger split-route suggestion */
  private readonly LARGE_TRADE_POOL_FRACTION = 0.03;

  constructor(
    private readonly poolDiscoveryService: PoolDiscoveryService,
    private readonly routingOptimizer: RoutingOptimizerService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.horizonUrl =
      this.configService.get<string>('STELLAR_HORIZON_URL') ??
      'https://horizon.stellar.org';
  }

  // -------------------------
  // Public API
  // -------------------------

  /**
   * Get the best swap quote for an asset pair,
   * comparing AMM pool(s) against the SDEX orderbook where requested.
   */
  async getSwapQuote(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
    const compareWithSdex = request.compareWithSdex ?? true;

    const pools = await this.poolDiscoveryService.findPoolsForPair(
      request.assetIn,
      request.assetOut,
    );
    const liquidPools = this.poolDiscoveryService.filterLiquidPools(pools);

    // Pick the pool with the best output
    let bestAmmQuote: AmmQuote | null = null;
    let bestPool: LiquidityPool | null = null;

    for (const pool of liquidPools) {
      const quote = this.routingOptimizer.computeAmmOutput(
        pool,
        request.assetIn,
        request.amountIn,
      );
      if (!quote) continue;
      if (!bestAmmQuote || quote.amountOut > bestAmmQuote.amountOut) {
        bestAmmQuote = quote;
        bestPool = pool;
      }
    }

    let sdexQuote: SdexOrderbookQuote | null = null;
    if (compareWithSdex) {
      sdexQuote = await this.fetchSdexQuote(
        request.assetIn,
        request.assetOut,
        request.amountIn,
      );
    }

    const routingDecision = this.routingOptimizer.compareAndRoute(
      bestAmmQuote,
      sdexQuote,
    );

    // Suggest split if the trade is large relative to pool reserves
    let splitRoute: SplitRoute | null = null;
    if (bestAmmQuote && sdexQuote && bestPool) {
      const reserveIn = bestPool.reserves.find((r) =>
        this.assetsMatch(r.asset, request.assetIn),
      );
      if (
        reserveIn &&
        request.amountIn / reserveIn.amountRaw > this.LARGE_TRADE_POOL_FRACTION
      ) {
        splitRoute = this.routingOptimizer.suggestSplitRoute(
          bestAmmQuote,
          sdexQuote,
          request.amountIn,
          bestPool,
        );
      }
    }

    return {
      request,
      routingDecision,
      splitRoute,
      pools: liquidPools,
      fetchedAt: new Date(),
    };
  }

  /**
   * Get all pools from the cache (or trigger a refresh if empty).
   */
  async getAllPools(): Promise<LiquidityPool[]> {
    if (this.poolCache.size === 0) {
      await this.refreshPoolCache();
    }
    return Array.from(this.poolCache.values());
  }

  /**
   * Get yield metrics for a specific pool.
   */
  async getPoolYield(poolId: string): Promise<PoolYield | null> {
    const pool =
      this.poolCache.get(poolId) ??
      (await this.poolDiscoveryService.getPool(poolId));

    if (!pool) return null;

    const volume24h = await this.fetchPool24hVolume(poolId);
    return this.poolDiscoveryService.computePoolYield(pool, volume24h);
  }

  /**
   * Get the LP token position and yield estimates for a given account.
   */
  async getLpPositions(stellarAccountId: string): Promise<LpPosition[]> {
    const url = `${this.horizonUrl}/accounts/${stellarAccountId}`;

    try {
      const response = await firstValueFrom(this.httpService.get(url));
      const balances: any[] = response.data?.balances ?? [];

      const lpBalances = balances.filter(
        (b: any) => b.asset_type === 'liquidity_pool_shares',
      );

      const positions: LpPosition[] = [];

      for (const lb of lpBalances) {
        const pool =
          this.poolCache.get(lb.liquidity_pool_id) ??
          (await this.poolDiscoveryService.getPool(lb.liquidity_pool_id));

        if (!pool) continue;

        const lpTokenBalance = lb.balance as string;
        const totalShares = parseFloat(pool.totalShares);
        const userShares = parseFloat(lpTokenBalance);
        const shareOfPool = totalShares > 0 ? userShares / totalShares : 0;

        const estimatedAssetAAmount = pool.reserves[0].amountRaw * shareOfPool;
        const estimatedAssetBAmount = pool.reserves[1].amountRaw * shareOfPool;

        const volume24h = await this.fetchPool24hVolume(pool.id);
        const yieldMetrics = this.poolDiscoveryService.computePoolYield(
          pool,
          volume24h,
        );

        positions.push({
          poolId: pool.id,
          pool,
          lpTokenBalance,
          shareOfPool: Math.round(shareOfPool * 1e8) / 1e8,
          estimatedAssetAAmount: Math.round(estimatedAssetAAmount * 1e7) / 1e7,
          estimatedAssetBAmount: Math.round(estimatedAssetBAmount * 1e7) / 1e7,
          yieldMetrics,
        });
      }

      return positions;
    } catch (err) {
      this.logger.error(
        `Failed to fetch LP positions for ${stellarAccountId}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  // -------------------------
  // Scheduled cache refresh
  // -------------------------

  @Cron(CronExpression.EVERY_10_MINUTES)
  async refreshPoolCache(): Promise<void> {
    this.logger.log('Refreshing AMM pool cache...');
    try {
      const pools = await this.poolDiscoveryService.discoverAllPools();
      const liquid = this.poolDiscoveryService.filterLiquidPools(pools);

      this.poolCache.clear();
      for (const pool of liquid) {
        this.poolCache.set(pool.id, pool);
      }

      this.cacheRefreshedAt = new Date();
      this.logger.log(
        `Pool cache refreshed: ${this.poolCache.size} liquid pools cached.`,
      );
    } catch (err) {
      this.logger.error(`Pool cache refresh failed: ${(err as Error).message}`);
    }
  }

  // -------------------------
  // Private helpers
  // -------------------------

  /**
   * Fetch an SDEX strict-receive path-payment quote from Horizon.
   */
  private async fetchSdexQuote(
    assetIn: StellarAsset,
    assetOut: StellarAsset,
    amountIn: number,
  ): Promise<SdexOrderbookQuote | null> {
    try {
      const params = new URLSearchParams({
        source_asset_type: assetIn.type,
        source_amount: amountIn.toFixed(7),
        destination_asset_type: assetOut.type,
      });

      if (assetIn.type !== 'native') {
        params.set('source_asset_code', assetIn.code);
        params.set('source_asset_issuer', assetIn.issuer!);
      }
      if (assetOut.type !== 'native') {
        params.set('destination_asset_code', assetOut.code);
        params.set('destination_asset_issuer', assetOut.issuer!);
      }

      const url = `${this.horizonUrl}/paths/strict-send?${params.toString()}`;
      const response = await firstValueFrom(this.httpService.get(url));
      const records: any[] = response.data?._embedded?.records ?? [];

      if (records.length === 0) return null;

      // Pick the path with the best destination amount
      const best = records.reduce((a: any, b: any) =>
        parseFloat(b.destination_amount) > parseFloat(a.destination_amount)
          ? b
          : a,
      );

      const amountOut = parseFloat(best.destination_amount);
      const slippageBps = 0; // Horizon path already accounts for orderbook depth

      return {
        assetIn,
        assetOut,
        amountIn,
        amountOut,
        pricePerUnit: amountIn > 0 ? amountOut / amountIn : 0,
        slippageBps,
        source: 'sdex',
      };
    } catch (err) {
      this.logger.warn(
        `SDEX quote fetch failed for ${assetIn.code}→${assetOut.code}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Fetch 24h volume for a pool from Horizon's trade aggregations.
   * Returns 0 if unavailable.
   */
  private async fetchPool24hVolume(poolId: string): Promise<number> {
    try {
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const params = new URLSearchParams({
        liquidity_pool_id: poolId,
        start_time: String(dayAgo),
        end_time: String(now),
        resolution: '86400000', // 1-day bucket
        limit: '1',
      });

      const url = `${this.horizonUrl}/trade_aggregations?${params.toString()}`;
      const response = await firstValueFrom(this.httpService.get(url));
      const records: any[] = response.data?._embedded?.records ?? [];

      if (records.length === 0) return 0;
      return parseFloat(records[0].base_volume ?? '0');
    } catch {
      return 0;
    }
  }

  private assetsMatch(a: StellarAsset, b: StellarAsset): boolean {
    if (a.type === 'native' && b.type === 'native') return true;
    return a.code === b.code && a.issuer === b.issuer;
  }
}
