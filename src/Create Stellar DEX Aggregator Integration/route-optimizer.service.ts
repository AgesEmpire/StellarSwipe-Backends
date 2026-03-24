import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { DexAdapter, DexQuote, LiquidityPoolInfo } from '../interfaces/dex-adapter.interface';
import { RouteRequest } from '../interfaces/quote-request.interface';
import { OptimalRouteDto, RouteHopDto, SplitAllocationDto } from '../dto/optimal-route.dto';
import { PriceComparator } from '../utils/price-comparator';
import { LiquidityAnalyzer } from '../utils/liquidity-analyzer';

@Injectable()
export class RouteOptimizerService {
  private readonly logger = new Logger(RouteOptimizerService.name);

  async findOptimalRoute(
    adapters: DexAdapter[],
    request: RouteRequest,
  ): Promise<OptimalRouteDto> {
    const [quotes, allPools] = await Promise.all([
      this.fetchAllQuotes(adapters, request),
      this.fetchAllPools(adapters, request),
    ]);

    if (!quotes.length) {
      throw new Error('No routes available from any DEX');
    }

    const liquidityAnalysis = LiquidityAnalyzer.analyze(allPools);

    if (request.splitRouting && request.maxSplits > 1 && allPools.length > 1) {
      return this.buildSplitRoute(quotes, allPools, request, liquidityAnalysis);
    }

    return this.buildSingleRoute(quotes, request, liquidityAnalysis);
  }

  private async fetchAllQuotes(
    adapters: DexAdapter[],
    request: RouteRequest,
  ): Promise<DexQuote[]> {
    const results = await Promise.allSettled(
      adapters.map((a) => a.getQuote(request)),
    );
    return results
      .filter(
        (r): r is PromiseFulfilledResult<DexQuote> => r.status === 'fulfilled',
      )
      .map((r) => r.value);
  }

  private async fetchAllPools(
    adapters: DexAdapter[],
    request: RouteRequest,
  ): Promise<LiquidityPoolInfo[]> {
    const assetPair = {
      baseAsset: request.sourceAsset,
      counterAsset: request.destinationAsset,
    };
    const results = await Promise.allSettled(
      adapters.map((a) => a.getLiquidityPools(assetPair)),
    );
    return results
      .filter(
        (r): r is PromiseFulfilledResult<LiquidityPoolInfo[]> =>
          r.status === 'fulfilled',
      )
      .flatMap((r) => r.value);
  }

  private buildSingleRoute(
    quotes: DexQuote[],
    request: RouteRequest,
    liquidityAnalysis: ReturnType<typeof LiquidityAnalyzer.analyze>,
  ): OptimalRouteDto {
    const ranked = PriceComparator.rankQuotes(quotes);
    const best = this.selectByStrategy(ranked, request.optimizationStrategy);

    const srcAmount = parseFloat(best.sourceAmount);
    const dstAmount = parseFloat(best.destinationAmount);
    const slippageTolerance = request.slippageTolerance || 0.5;
    const minDestAmount = dstAmount * (1 - slippageTolerance / 100);

    const hops: RouteHopDto[] = [
      {
        fromAsset: request.sourceAsset,
        toAsset: request.destinationAsset,
        dexId: best.dexId,
        expectedOutput: best.destinationAmount,
      },
      ...best.path.slice(0, -1).map((asset, i) => ({
        fromAsset: best.path[i],
        toAsset: best.path[i + 1] || request.destinationAsset,
        dexId: best.dexId,
        expectedOutput: '0', // intermediate hops
      })),
    ];

    const score = this.computeOptimizationScore(best, liquidityAnalysis);

    return {
      routeId: uuidv4(),
      routeType: best.path.length > 0 ? 'multi-hop' : 'single',
      sourceAmount: best.sourceAmount,
      expectedDestinationAmount: best.destinationAmount,
      minimumDestinationAmount: minDestAmount.toFixed(7),
      hops,
      totalFee: best.fee,
      estimatedSlippage: best.estimatedSlippage,
      priceImpact: best.estimatedSlippage,
      confidence: best.confidence,
      optimizationScore: score,
      estimatedExecutionTimeMs: 5000, // ~5s for Stellar ledger
      expiresAt: best.expiresAt,
    };
  }

  private buildSplitRoute(
    quotes: DexQuote[],
    pools: LiquidityPoolInfo[],
    request: RouteRequest,
    liquidityAnalysis: ReturnType<typeof LiquidityAnalyzer.analyze>,
  ): OptimalRouteDto {
    const tradeSize = parseFloat(request.sourceAmount || '0');
    const optimalSplits = LiquidityAnalyzer.computeOptimalSplit(
      tradeSize,
      pools,
      request.maxSplits || 3,
    );

    const splits: SplitAllocationDto[] = optimalSplits.map((split) => {
      const matchedQuote = quotes.find((q) => q.dexId === split.dexId);
      const ratio = split.allocatedAmount / tradeSize;
      return {
        dexId: split.dexId,
        dexName: matchedQuote?.dexName || split.dexId,
        allocationPercent: split.allocationPercent,
        sourceAmount: split.allocatedAmount.toFixed(7),
        expectedDestinationAmount: matchedQuote
          ? (parseFloat(matchedQuote.destinationAmount) * ratio).toFixed(7)
          : '0',
      };
    });

    const totalDst = splits.reduce(
      (sum, s) => sum + parseFloat(s.expectedDestinationAmount),
      0,
    );
    const avgSlippage =
      optimalSplits.reduce((s, sp) => s + sp.expectedSlippage, 0) /
      optimalSplits.length;
    const slippageTolerance = request.slippageTolerance || 0.5;

    return {
      routeId: uuidv4(),
      routeType: 'split',
      sourceAmount: request.sourceAmount || '0',
      expectedDestinationAmount: totalDst.toFixed(7),
      minimumDestinationAmount: (
        totalDst *
        (1 - slippageTolerance / 100)
      ).toFixed(7),
      hops: splits.map((s) => ({
        fromAsset: request.sourceAsset,
        toAsset: request.destinationAsset,
        dexId: s.dexId,
        expectedOutput: s.expectedDestinationAmount,
      })),
      splits,
      totalFee: quotes.reduce((s, q) => s + q.fee, 0) / quotes.length,
      estimatedSlippage: avgSlippage,
      priceImpact: avgSlippage,
      confidence: 0.85,
      optimizationScore: 80,
      estimatedExecutionTimeMs: 8000,
      expiresAt: new Date(Date.now() + 20_000),
    };
  }

  private selectByStrategy(
    ranked: DexQuote[],
    strategy: RouteRequest['optimizationStrategy'],
  ): DexQuote {
    switch (strategy) {
      case 'best_price':
        return ranked.reduce((a, b) => (b.price > a.price ? b : a));
      case 'lowest_fee':
        return ranked.reduce((a, b) => (b.fee < a.fee ? b : a));
      case 'fastest':
        // Prefer direct routes (shorter path)
        return ranked.reduce((a, b) => (b.path.length < a.path.length ? b : a));
      case 'balanced':
      default:
        return ranked[0]; // PriceComparator's composite score
    }
  }

  private computeOptimizationScore(
    quote: DexQuote,
    analysis: ReturnType<typeof LiquidityAnalyzer.analyze>,
  ): number {
    const priceScore = Math.min(50, quote.confidence * 50);
    const feeScore = Math.max(0, 25 - quote.fee * 1000);
    const liquidityScore = Math.min(25, analysis.depthScore / 4);
    return Math.round(priceScore + feeScore + liquidityScore);
  }
}
