import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface LiquidityPool {
  id: string;
  type: 'constant_product';
  fee: number;
  totalTrustlines: number;
  totalShares: string;
  reserves: PoolReserve[];
  assetA: StellarAsset;
  assetB: StellarAsset;
  tvlUsdc: number | null;
  apy: number | null;
  volume24h: number | null;
  discoveredAt: Date;
}

export interface PoolReserve {
  asset: StellarAsset;
  amount: string;
  amountRaw: number;
}

export interface StellarAsset {
  type: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  code: string;
  issuer: string | null;
}

export interface PoolYield {
  poolId: string;
  apy: number;
  feeApy: number;
  volume24h: number;
  fees24h: number;
  tvlUsdc: number;
  lpTokenPrice: number;
  calculatedAt: Date;
}

@Injectable()
export class PoolDiscoveryService {
  private readonly logger = new Logger(PoolDiscoveryService.name);
  private readonly horizonUrl: string;

  // Constant product AMM fee on Stellar is fixed at 0.3%
  private readonly POOL_FEE = 0.003;
  // Minimum TVL in USDC to consider a pool liquid enough
  private readonly MIN_TVL_USDC = 500;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.horizonUrl =
      this.configService.get<string>('STELLAR_HORIZON_URL') ??
      'https://horizon.stellar.org';
  }

  /**
   * Discover all active liquidity pools from Horizon.
   * Paginates through all pages and returns the full list.
   */
  async discoverAllPools(): Promise<LiquidityPool[]> {
    this.logger.log('Starting liquidity pool discovery...');
    const pools: LiquidityPool[] = [];
    let cursor: string | null = null;

    do {
      const url = this.buildPoolListUrl(cursor);
      const response = await firstValueFrom(this.httpService.get(url));
      const records: any[] = response.data?._embedded?.records ?? [];

      if (records.length === 0) break;

      for (const record of records) {
        const pool = this.mapHorizonPool(record);
        if (pool) pools.push(pool);
      }

      const nextHref: string | undefined = response.data?._links?.next?.href;
      cursor = nextHref ? this.extractCursor(nextHref) : null;
    } while (cursor);

    this.logger.log(`Discovered ${pools.length} liquidity pools.`);
    return pools;
  }

  /**
   * Find pools that contain both assets of a given trading pair.
   */
  async findPoolsForPair(
    assetA: StellarAsset,
    assetB: StellarAsset,
  ): Promise<LiquidityPool[]> {
    const url = this.buildPoolForPairUrl(assetA, assetB);

    try {
      const response = await firstValueFrom(this.httpService.get(url));
      const records: any[] = response.data?._embedded?.records ?? [];
      return records
        .map((r) => this.mapHorizonPool(r))
        .filter((p): p is LiquidityPool => p !== null);
    } catch (err) {
      this.logger.warn(
        `Failed to find pools for pair ${assetA.code}/${assetB.code}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Fetch a single pool by its ID.
   */
  async getPool(poolId: string): Promise<LiquidityPool | null> {
    try {
      const url = `${this.horizonUrl}/liquidity_pools/${poolId}`;
      const response = await firstValueFrom(this.httpService.get(url));
      return this.mapHorizonPool(response.data);
    } catch {
      return null;
    }
  }

  /**
   * Compute yield metrics for a pool given 24h volume data.
   */
  computePoolYield(pool: LiquidityPool, volume24hUsdc: number): PoolYield {
    const tvl = pool.tvlUsdc ?? 0;
    const fees24h = volume24hUsdc * this.POOL_FEE;
    const feeApy = tvl > 0 ? (fees24h / tvl) * 365 * 100 : 0;
    const lpTokenPrice =
      pool.totalShares !== '0' ? tvl / parseFloat(pool.totalShares) : 0;

    return {
      poolId: pool.id,
      apy: feeApy,
      feeApy,
      volume24h: volume24hUsdc,
      fees24h,
      tvlUsdc: tvl,
      lpTokenPrice,
      calculatedAt: new Date(),
    };
  }

  /**
   * Filter pools that meet the minimum liquidity threshold.
   */
  filterLiquidPools(pools: LiquidityPool[]): LiquidityPool[] {
    return pools.filter(
      (p) =>
        p.totalTrustlines > 0 &&
        (p.tvlUsdc === null || p.tvlUsdc >= this.MIN_TVL_USDC),
    );
  }

  // -------------------------
  // Private helpers
  // -------------------------

  private buildPoolListUrl(cursor: string | null): string {
    const params = new URLSearchParams({ limit: '200', order: 'desc' });
    if (cursor) params.set('cursor', cursor);
    return `${this.horizonUrl}/liquidity_pools?${params.toString()}`;
  }

  private buildPoolForPairUrl(a: StellarAsset, b: StellarAsset): string {
    const params = new URLSearchParams({ limit: '10' });
    params.set('reserves', `${this.assetToParam(a)},${this.assetToParam(b)}`);
    return `${this.horizonUrl}/liquidity_pools?${params.toString()}`;
  }

  private assetToParam(asset: StellarAsset): string {
    if (asset.type === 'native') return 'native';
    return `${asset.code}:${asset.issuer}`;
  }

  private extractCursor(nextHref: string): string | null {
    try {
      const url = new URL(nextHref);
      return url.searchParams.get('cursor');
    } catch {
      return null;
    }
  }

  private mapHorizonPool(record: any): LiquidityPool | null {
    try {
      const reserves: PoolReserve[] = (record.reserves ?? []).map((r: any) => ({
        asset: this.parseAssetString(r.asset),
        amount: r.amount,
        amountRaw: parseFloat(r.amount),
      }));

      if (reserves.length !== 2) return null;

      return {
        id: record.id,
        type: 'constant_product',
        fee: this.POOL_FEE,
        totalTrustlines: record.total_trustlines ?? 0,
        totalShares: record.total_shares ?? '0',
        reserves,
        assetA: reserves[0].asset,
        assetB: reserves[1].asset,
        tvlUsdc: null, // enriched externally
        apy: null,
        volume24h: null,
        discoveredAt: new Date(),
      };
    } catch {
      return null;
    }
  }

  private parseAssetString(assetStr: string): StellarAsset {
    if (assetStr === 'native') {
      return { type: 'native', code: 'XLM', issuer: null };
    }
    const [code, issuer] = assetStr.split(':');
    const type = code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12';
    return { type, code, issuer: issuer ?? null };
  }
}
