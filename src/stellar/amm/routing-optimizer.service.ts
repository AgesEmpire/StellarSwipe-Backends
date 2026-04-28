import { Injectable, Logger } from '@nestjs/common';
import { LiquidityPool, StellarAsset } from './pool-discovery.service';

export enum RouteType {
  SDEX = 'sdex',
  AMM = 'amm',
  HYBRID = 'hybrid',
}

export interface SdexOrderbookQuote {
  assetIn: StellarAsset;
  assetOut: StellarAsset;
  amountIn: number;
  amountOut: number;
  pricePerUnit: number;
  slippageBps: number;
  source: 'sdex';
}

export interface AmmQuote {
  pool: LiquidityPool;
  assetIn: StellarAsset;
  assetOut: StellarAsset;
  amountIn: number;
  amountOut: number;
  pricePerUnit: number;
  priceImpactBps: number;
  fee: number;
  source: 'amm';
}

export interface RoutingDecision {
  recommendedRoute: RouteType;
  bestAmountOut: number;
  ammQuote: AmmQuote | null;
  sdexQuote: SdexOrderbookQuote | null;
  priceDeltaBps: number;
  reasoning: string;
  decidedAt: Date;
}

export interface SplitRoute {
  ammFraction: number;
  sdexFraction: number;
  estimatedAmountOut: number;
  reasoning: string;
}

@Injectable()
export class RoutingOptimizerService {
  private readonly logger = new Logger(RoutingOptimizerService.name);

  // Minimum advantage in bps before preferring AMM over SDEX
  private readonly AMM_PREFERENCE_THRESHOLD_BPS = 10;
  // Maximum acceptable price impact for AMM in bps
  private readonly MAX_PRICE_IMPACT_BPS = 200;

  /**
   * Given an AMM quote and an SDEX quote for the same swap,
   * decide the optimal routing and return a structured decision.
   */
  compareAndRoute(
    ammQuote: AmmQuote | null,
    sdexQuote: SdexOrderbookQuote | null,
  ): RoutingDecision {
    if (!ammQuote && !sdexQuote) {
      throw new Error(
        'At least one quote (AMM or SDEX) is required for routing.',
      );
    }

    if (!sdexQuote && ammQuote) {
      return this.buildDecision(
        RouteType.AMM,
        ammQuote,
        null,
        ammQuote.amountOut,
        0,
        'No SDEX liquidity available; routing entirely through AMM pool.',
      );
    }

    if (!ammQuote && sdexQuote) {
      return this.buildDecision(
        RouteType.SDEX,
        null,
        sdexQuote,
        sdexQuote.amountOut,
        0,
        'No AMM pool available for this pair; routing through SDEX orderbook.',
      );
    }

    // Both quotes exist — compare
    const ammOut = ammQuote!.amountOut;
    const sdexOut = sdexQuote!.amountOut;
    const deltaBps = Math.round(((ammOut - sdexOut) / sdexOut) * 10000);

    // Reject AMM if price impact is too high
    if (ammQuote!.priceImpactBps > this.MAX_PRICE_IMPACT_BPS) {
      return this.buildDecision(
        RouteType.SDEX,
        ammQuote,
        sdexQuote,
        sdexOut,
        deltaBps,
        `AMM price impact too high (${ammQuote!.priceImpactBps} bps > ${this.MAX_PRICE_IMPACT_BPS} bps limit); using SDEX.`,
      );
    }

    if (deltaBps >= this.AMM_PREFERENCE_THRESHOLD_BPS) {
      return this.buildDecision(
        RouteType.AMM,
        ammQuote,
        sdexQuote,
        ammOut,
        deltaBps,
        `AMM offers ${deltaBps} bps better output; routing through liquidity pool ${ammQuote!.pool.id}.`,
      );
    }

    if (deltaBps <= -this.AMM_PREFERENCE_THRESHOLD_BPS) {
      return this.buildDecision(
        RouteType.SDEX,
        ammQuote,
        sdexQuote,
        sdexOut,
        deltaBps,
        `SDEX offers better price by ${Math.abs(deltaBps)} bps; routing through orderbook.`,
      );
    }

    // Within threshold — prefer SDEX for determinism
    return this.buildDecision(
      RouteType.SDEX,
      ammQuote,
      sdexQuote,
      sdexOut,
      deltaBps,
      `Prices are within ${this.AMM_PREFERENCE_THRESHOLD_BPS} bps of each other; defaulting to SDEX for price determinism.`,
    );
  }

  /**
   * Compute the AMM constant-product output for a given input.
   * Formula: amountOut = (reserveOut * amountIn * (1 - fee)) /
   *                      (reserveIn + amountIn * (1 - fee))
   */
  computeAmmOutput(
    pool: LiquidityPool,
    assetIn: StellarAsset,
    amountIn: number,
  ): AmmQuote | null {
    const reserveIn = pool.reserves.find((r) =>
      this.assetsMatch(r.asset, assetIn),
    );
    const reserveOut = pool.reserves.find(
      (r) => !this.assetsMatch(r.asset, assetIn),
    );

    if (!reserveIn || !reserveOut) {
      this.logger.warn(`Asset ${assetIn.code} not found in pool ${pool.id}`);
      return null;
    }

    if (reserveIn.amountRaw === 0 || reserveOut.amountRaw === 0) {
      return null;
    }

    const feeMultiplier = 1 - pool.fee;
    const amountInWithFee = amountIn * feeMultiplier;
    const amountOut =
      (reserveOut.amountRaw * amountInWithFee) /
      (reserveIn.amountRaw + amountInWithFee);

    const spotPriceBefore = reserveOut.amountRaw / reserveIn.amountRaw;
    const effectivePrice = amountOut / amountIn;
    const priceImpactBps = Math.round(
      ((spotPriceBefore - effectivePrice) / spotPriceBefore) * 10000,
    );

    return {
      pool,
      assetIn,
      assetOut: reserveOut.asset,
      amountIn,
      amountOut: Math.floor(amountOut * 1e7) / 1e7, // 7 decimal precision (Stellar stroops)
      pricePerUnit: effectivePrice,
      priceImpactBps: Math.max(0, priceImpactBps),
      fee: amountIn * pool.fee,
      source: 'amm',
    };
  }

  /**
   * Suggest an optimal split between AMM and SDEX for large trades
   * where routing 100% through either venue causes excessive slippage.
   */
  suggestSplitRoute(
    ammQuote: AmmQuote,
    sdexQuote: SdexOrderbookQuote,
    totalAmountIn: number,
    pool: LiquidityPool,
  ): SplitRoute {
    // Binary search for the AMM fraction that minimises blended slippage
    let bestFraction = 0.5;
    let bestOutput = -Infinity;

    for (let frac = 0.1; frac <= 0.9; frac += 0.1) {
      const ammIn = totalAmountIn * frac;
      const sdexIn = totalAmountIn * (1 - frac);

      const ammPart = this.computeAmmOutput(pool, ammQuote.assetIn, ammIn);
      if (!ammPart) continue;

      const sdexPart = (sdexQuote.amountOut / sdexQuote.amountIn) * sdexIn;
      const blended = ammPart.amountOut + sdexPart;

      if (blended > bestOutput) {
        bestOutput = blended;
        bestFraction = frac;
      }
    }

    const sdexFraction = 1 - bestFraction;

    return {
      ammFraction: Math.round(bestFraction * 100) / 100,
      sdexFraction: Math.round(sdexFraction * 100) / 100,
      estimatedAmountOut: Math.round(bestOutput * 1e7) / 1e7,
      reasoning:
        `Optimal split: ${(bestFraction * 100).toFixed(0)}% AMM / ` +
        `${(sdexFraction * 100).toFixed(0)}% SDEX — blended output: ${bestOutput.toFixed(7)}.`,
    };
  }

  // -------------------------
  // Private helpers
  // -------------------------

  private buildDecision(
    route: RouteType,
    ammQuote: AmmQuote | null,
    sdexQuote: SdexOrderbookQuote | null,
    bestAmountOut: number,
    priceDeltaBps: number,
    reasoning: string,
  ): RoutingDecision {
    return {
      recommendedRoute: route,
      bestAmountOut,
      ammQuote,
      sdexQuote,
      priceDeltaBps,
      reasoning,
      decidedAt: new Date(),
    };
  }

  private assetsMatch(a: StellarAsset, b: StellarAsset): boolean {
    if (a.type === 'native' && b.type === 'native') return true;
    return a.code === b.code && a.issuer === b.issuer;
  }
}
