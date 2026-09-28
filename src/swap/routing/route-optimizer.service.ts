import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SwapRouteRequestDto } from './dto/swap-route-request.dto';
import {
  SwapRouteResponseDto,
  SwapRouteDto,
  SwapHopDto,
} from './dto/swap-route-response.dto';
import {
  SwapEdge,
  buildAdjacencyMap,
  findAllPaths,
  selectBestPath,
  SwapPath,
} from './utils/path-finder';

/**
 * Simulated market data for an asset pair.
 * In production this would be sourced from Stellar Horizon / SDEX.
 */
export interface MarketPairData {
  fromAsset: string;
  toAsset: string;
  /** Available liquidity in source-asset units */
  liquidity: number;
  /** Fee rate as a fraction (e.g. 0.003 = 0.3%) */
  feeRate: number;
  /** Exchange rate: destination units per source unit */
  exchangeRate: number;
  /** Estimated price impact for a standard trade size */
  priceImpact: number;
}

@Injectable()
export class RouteOptimizerService {
  private readonly logger = new Logger(RouteOptimizerService.name);

  /**
   * Find the optimal swap route for the given request.
   *
   * The service:
   *  1. Fetches available market pairs (liquidity, fees, exchange rates).
   *  2. Builds an asset graph and runs best-first path search.
   *  3. Accounts for market depth and execution fees when scoring paths.
   *  4. Returns the best route plus alternatives.
   */
  async optimizeRoute(request: SwapRouteRequestDto): Promise<SwapRouteResponseDto> {
    this.logger.log(
      `Optimising swap route: ${request.sourceAsset} → ${request.destinationAsset}, ` +
        `amount: ${request.amount}`,
    );

    if (request.sourceAsset === request.destinationAsset) {
      throw new BadRequestException('Source and destination assets must be different');
    }

    if (request.amount <= 0) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    // Fetch market data and build the asset graph
    const marketPairs = await this.fetchMarketPairs(
      request.sourceAsset,
      request.destinationAsset,
      request.allowedIntermediaryAssets,
    );

    if (marketPairs.length === 0) {
      this.logger.warn(
        `No market pairs found for ${request.sourceAsset} → ${request.destinationAsset}`,
      );
      return this.buildEmptyResponse(request);
    }

    // Adjust price impact based on the requested amount vs. available liquidity
    const edges: SwapEdge[] = marketPairs.map((pair) =>
      this.buildEdge(pair, request.amount),
    );

    const adjacencyMap = buildAdjacencyMap(edges);

    const paths = findAllPaths(
      request.sourceAsset,
      request.destinationAsset,
      adjacencyMap,
      request.amount,
      {
        maxHops: request.maxHops ?? 3,
        minLiquidity: request.minLiquidity ?? 0,
        maxPaths: 5,
      },
    );

    const bestPath = selectBestPath(paths);
    const alternativePaths = paths.filter((p) => p !== bestPath);

    this.logger.log(
      `Route optimisation complete: ${paths.length} routes found for ` +
        `${request.sourceAsset} → ${request.destinationAsset}`,
    );

    return {
      sourceAsset: request.sourceAsset,
      destinationAsset: request.destinationAsset,
      amount: request.amount,
      bestRoute: bestPath ? this.toRouteDto(bestPath) : null,
      alternativeRoutes: alternativePaths.map((p) => this.toRouteDto(p)),
      routeCount: paths.length,
      computedAt: new Date().toISOString(),
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Fetch available market pairs from the exchange graph.
   *
   * In a real implementation this would query Stellar Horizon path-payment
   * strict-send/receive endpoints or the SDEX orderbook. Here we provide a
   * representative set of well-known Stellar asset pairs so the path-finder
   * has a realistic graph to traverse.
   */
  private async fetchMarketPairs(
    source: string,
    destination: string,
    allowedIntermediaries?: string[],
  ): Promise<MarketPairData[]> {
    // Representative Stellar asset graph (native = XLM)
    const allPairs: MarketPairData[] = [
      // XLM ↔ USDC
      { fromAsset: 'native', toAsset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', liquidity: 500_000, feeRate: 0.003, exchangeRate: 0.11, priceImpact: 0.001 },
      { fromAsset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', toAsset: 'native', liquidity: 55_000, feeRate: 0.003, exchangeRate: 9.09, priceImpact: 0.001 },
      // XLM ↔ BTC
      { fromAsset: 'native', toAsset: 'BTC:GAUTUYY2THLF7SGITDFMXJVYH3LHDSMGEAKSBU267M2K7A3W543CKUEF', liquidity: 200_000, feeRate: 0.003, exchangeRate: 0.0000018, priceImpact: 0.002 },
      { fromAsset: 'BTC:GAUTUYY2THLF7SGITDFMXJVYH3LHDSMGEAKSBU267M2K7A3W543CKUEF', toAsset: 'native', liquidity: 0.36, feeRate: 0.003, exchangeRate: 555_555, priceImpact: 0.002 },
      // USDC ↔ BTC
      { fromAsset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', toAsset: 'BTC:GAUTUYY2THLF7SGITDFMXJVYH3LHDSMGEAKSBU267M2K7A3W543CKUEF', liquidity: 100_000, feeRate: 0.003, exchangeRate: 0.0000165, priceImpact: 0.003 },
      { fromAsset: 'BTC:GAUTUYY2THLF7SGITDFMXJVYH3LHDSMGEAKSBU267M2K7A3W543CKUEF', toAsset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', liquidity: 1.65, feeRate: 0.003, exchangeRate: 60_606, priceImpact: 0.003 },
      // XLM ↔ ETH
      { fromAsset: 'native', toAsset: 'ETH:GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR', liquidity: 300_000, feeRate: 0.003, exchangeRate: 0.000034, priceImpact: 0.002 },
      { fromAsset: 'ETH:GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR', toAsset: 'native', liquidity: 10.2, feeRate: 0.003, exchangeRate: 29_411, priceImpact: 0.002 },
      // USDC ↔ ETH
      { fromAsset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', toAsset: 'ETH:GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR', liquidity: 80_000, feeRate: 0.003, exchangeRate: 0.00031, priceImpact: 0.002 },
      { fromAsset: 'ETH:GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR', toAsset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', liquidity: 24.8, feeRate: 0.003, exchangeRate: 3_225, priceImpact: 0.002 },
    ];

    // Filter to pairs that are reachable from source or lead to destination,
    // and respect the intermediary whitelist when provided.
    return allPairs.filter((pair) => {
      if (allowedIntermediaries && allowedIntermediaries.length > 0) {
        const isEndpoint = pair.fromAsset === source || pair.toAsset === destination ||
          pair.fromAsset === destination || pair.toAsset === source;
        const isAllowedIntermediary =
          allowedIntermediaries.includes(pair.fromAsset) ||
          allowedIntermediaries.includes(pair.toAsset);
        return isEndpoint || isAllowedIntermediary;
      }
      return true;
    });
  }

  /**
   * Convert a MarketPairData into a SwapEdge, adjusting price impact for
   * the requested trade size relative to available liquidity.
   */
  private buildEdge(pair: MarketPairData, requestedAmount: number): SwapEdge {
    // Scale price impact by the fraction of liquidity consumed
    const liquidityFraction =
      pair.liquidity > 0 ? Math.min(requestedAmount / pair.liquidity, 1) : 1;
    const adjustedPriceImpact = pair.priceImpact * (1 + liquidityFraction);

    return {
      from: pair.fromAsset,
      to: pair.toAsset,
      liquidity: pair.liquidity,
      feeRate: pair.feeRate,
      priceImpact: adjustedPriceImpact,
      exchangeRate: pair.exchangeRate,
    };
  }

  private toRouteDto(path: SwapPath): SwapRouteDto {
    const hopDetails: SwapHopDto[] = path.edges.map((edge) => ({
      fromAsset: edge.from,
      toAsset: edge.to,
      exchangeRate: edge.exchangeRate,
      feeRate: edge.feeRate,
      priceImpact: edge.priceImpact,
      liquidity: edge.liquidity,
    }));

    return {
      hops: path.hops,
      hopDetails,
      expectedOutput: path.expectedOutput,
      totalFeeRate: path.totalFeeRate,
      totalPriceImpact: path.totalPriceImpact,
      totalCost: path.totalCost,
      hopCount: path.edges.length,
    };
  }

  private buildEmptyResponse(request: SwapRouteRequestDto): SwapRouteResponseDto {
    return {
      sourceAsset: request.sourceAsset,
      destinationAsset: request.destinationAsset,
      amount: request.amount,
      bestRoute: null,
      alternativeRoutes: [],
      routeCount: 0,
      computedAt: new Date().toISOString(),
    };
  }
}
