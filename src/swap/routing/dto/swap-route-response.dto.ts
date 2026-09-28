export class SwapHopDto {
  /** Source asset of this hop */
  fromAsset!: string;
  /** Destination asset of this hop */
  toAsset!: string;
  /** Exchange rate for this hop */
  exchangeRate!: number;
  /** Fee rate for this hop (fraction, e.g. 0.003) */
  feeRate!: number;
  /** Estimated price impact for this hop (fraction) */
  priceImpact!: number;
  /** Available liquidity at this hop in source-asset units */
  liquidity!: number;
}

export class SwapRouteDto {
  /** Ordered list of asset IDs from source to destination */
  hops!: string[];
  /** Detailed breakdown per hop */
  hopDetails!: SwapHopDto[];
  /** Expected output amount after all hops */
  expectedOutput!: number;
  /** Aggregate fee rate across all hops (fraction) */
  totalFeeRate!: number;
  /** Aggregate price impact across all hops (fraction) */
  totalPriceImpact!: number;
  /** Combined cost score (lower is better) */
  totalCost!: number;
  /** Number of hops in this route */
  hopCount!: number;
}

export class SwapRouteResponseDto {
  /** Source asset identifier */
  sourceAsset!: string;
  /** Destination asset identifier */
  destinationAsset!: string;
  /** Input amount */
  amount!: number;
  /** The recommended (lowest-cost) route */
  bestRoute!: SwapRouteDto | null;
  /** All viable alternative routes, sorted by cost ascending */
  alternativeRoutes!: SwapRouteDto[];
  /** Total number of routes found */
  routeCount!: number;
  /** ISO timestamp of when the optimisation was computed */
  computedAt!: string;
}
