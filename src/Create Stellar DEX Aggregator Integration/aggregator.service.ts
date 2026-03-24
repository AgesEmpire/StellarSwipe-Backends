import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LobstrDexAdapter } from './dexes/lobstr-dex.adapter';
import { StellarxDexAdapter } from './dexes/stellarx-dex.adapter';
import { StellarTermDexAdapter } from './dexes/stellarterm-dex.adapter';
import { DexAdapter, AssetPair } from './interfaces/dex-adapter.interface';
import { QuoteRequest, RouteRequest } from './interfaces/quote-request.interface';
import { QuoteAggregatorService } from './services/quote-aggregator.service';
import { RouteOptimizerService } from './services/route-optimizer.service';
import { PriceComparator } from './utils/price-comparator';
import { LiquidityAnalyzer } from './utils/liquidity-analyzer';
import { AggregatedQuoteDto, DexComparisonDto } from './dto/aggregated-quote.dto';
import { OptimalRouteDto } from './dto/optimal-route.dto';
import { DexRouteEntity } from './entities/dex-route.entity';
import { LiquidityPoolEntity } from './entities/liquidity-pool.entity';

@Injectable()
export class AggregatorService {
  private readonly logger = new Logger(AggregatorService.name);
  private readonly adapters: DexAdapter[];

  constructor(
    private readonly lobstr: LobstrDexAdapter,
    private readonly stellarx: StellarxDexAdapter,
    private readonly stellarterm: StellarTermDexAdapter,
    private readonly quoteAggregator: QuoteAggregatorService,
    private readonly routeOptimizer: RouteOptimizerService,
    @InjectRepository(DexRouteEntity)
    private readonly routeRepo: Repository<DexRouteEntity>,
    @InjectRepository(LiquidityPoolEntity)
    private readonly poolRepo: Repository<LiquidityPoolEntity>,
  ) {
    this.adapters = [lobstr, stellarx, stellarterm];
  }

  /**
   * Get aggregated quotes from all DEXes and return the best
   */
  async getAggregatedQuote(request: QuoteRequest): Promise<AggregatedQuoteDto> {
    this.logger.log(
      `Aggregating quotes: ${request.sourceAsset.code} → ${request.destinationAsset.code}`,
    );

    const result = await this.quoteAggregator.getAggregatedQuoteDto(
      this.getActiveAdapters(request),
      request,
    );

    // Persist best quote
    await this.persistRoute(result.bestQuote, request).catch((err) =>
      this.logger.error('Failed to persist route:', err),
    );

    return result;
  }

  /**
   * Compare prices across all DEXes side-by-side
   */
  async compareDexes(request: QuoteRequest): Promise<DexComparisonDto> {
    const { quotes } = await this.quoteAggregator.aggregateQuotes(
      this.getActiveAdapters(request),
      request,
    );

    if (!quotes.length) {
      throw new Error('No quotes available for comparison');
    }

    const ranked = PriceComparator.rankQuotes(quotes);
    const healthStatus = await this.quoteAggregator.checkHealth(this.adapters);

    const comparisons = ranked.map((q) => ({
      dexId: q.dexId,
      dexName: q.dexName,
      price: q.price,
      fee: q.fee,
      estimatedSlippage: q.estimatedSlippage,
      netPrice: q.netPrice,
      rank: q.rank,
      priceDifferencePercent: q.priceDifferencePercent,
      isHealthy: healthStatus[q.dexId] ?? false,
    }));

    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    const spread =
      worst.price > 0
        ? ((best.price - worst.price) / worst.price) * 100
        : 0;

    return {
      comparisons,
      bestDexId: best.dexId,
      worstDexId: worst.dexId,
      spreadPercent: spread,
      timestamp: new Date(),
    };
  }

  /**
   * Find the optimal execution route, optionally with split routing
   */
  async findOptimalRoute(request: RouteRequest): Promise<OptimalRouteDto> {
    this.logger.log(
      `Finding optimal route [${request.optimizationStrategy}]: ` +
        `${request.sourceAsset.code} → ${request.destinationAsset.code}`,
    );
    return this.routeOptimizer.findOptimalRoute(
      this.getActiveAdapters(request),
      request,
    );
  }

  /**
   * Aggregate liquidity pools across all DEXes
   */
  async getAggregatedLiquidity(assetPair: AssetPair) {
    const results = await Promise.allSettled(
      this.adapters.map((a) => a.getLiquidityPools(assetPair)),
    );

    const allPools = results
      .filter(
        (r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled',
      )
      .flatMap((r) => r.value);

    const analysis = LiquidityAnalyzer.analyze(allPools);

    // Sync to DB
    await this.syncPoolsToDb(allPools, assetPair).catch((err) =>
      this.logger.error('Pool sync failed:', err),
    );

    return { pools: allPools, analysis };
  }

  /**
   * Get health status of all connected DEXes
   */
  async getDexHealthStatus(): Promise<Record<string, boolean>> {
    return this.quoteAggregator.checkHealth(this.adapters);
  }

  /**
   * Retrieve historical routes from DB
   */
  async getRouteHistory(
    sourceCode: string,
    destCode: string,
    limit = 50,
  ): Promise<DexRouteEntity[]> {
    return this.routeRepo.find({
      where: {
        sourceAssetCode: sourceCode,
        destinationAssetCode: destCode,
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private getActiveAdapters(request: QuoteRequest): DexAdapter[] {
    return this.adapters.filter(
      (a) => !request.excludeDexes?.includes(a.dexId),
    );
  }

  private async persistRoute(quote: any, request: QuoteRequest): Promise<void> {
    const entity = this.routeRepo.create({
      dexId: quote.dexId,
      dexName: quote.dexName,
      sourceAssetCode: request.sourceAsset.code,
      sourceAssetIssuer: request.sourceAsset.issuer,
      destinationAssetCode: request.destinationAsset.code,
      destinationAssetIssuer: request.destinationAsset.issuer,
      sourceAmount: parseFloat(quote.sourceAmount),
      destinationAmount: parseFloat(quote.destinationAmount),
      price: quote.price,
      fee: quote.fee,
      path: quote.path,
      estimatedSlippage: quote.estimatedSlippage,
      confidence: quote.confidence,
      isOptimal: true,
      expiresAt: quote.expiresAt,
    });
    await this.routeRepo.save(entity);
  }

  private async syncPoolsToDb(
    pools: any[],
    assetPair: AssetPair,
  ): Promise<void> {
    for (const pool of pools) {
      await this.poolRepo
        .upsert(
          {
            poolId: pool.poolId,
            dexId: pool.dexId,
            assetCodeA: assetPair.baseAsset.code,
            assetIssuerA: assetPair.baseAsset.issuer,
            assetCodeB: assetPair.counterAsset.code,
            assetIssuerB: assetPair.counterAsset.issuer,
            totalValueLocked: pool.totalValueLocked,
            volume24h: pool.volume24h,
            fee: pool.fee,
            reserveA: parseFloat(pool.reserveA),
            reserveB: parseFloat(pool.reserveB),
            lastSyncedAt: new Date(),
          },
          ['poolId'],
        )
        .catch(() => null); // silently skip duplicate conflicts
    }
  }
}
