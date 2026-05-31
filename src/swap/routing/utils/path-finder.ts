/**
 * Path-finding utilities for multi-hop swap route optimisation.
 *
 * Uses a modified Dijkstra / best-first search over an asset graph where
 * edge weights represent the effective cost (fees + slippage) of each hop.
 */

export interface AssetNode {
  /** Unique identifier: 'native' for XLM, or '<CODE>:<ISSUER>' for other assets */
  assetId: string;
}

export interface SwapEdge {
  from: string;
  to: string;
  /** Available liquidity in source-asset units */
  liquidity: number;
  /** Fee as a fraction (e.g. 0.003 = 0.3%) */
  feeRate: number;
  /** Estimated price impact for the requested amount (0–1) */
  priceImpact: number;
  /** Exchange rate: how many destination units per source unit */
  exchangeRate: number;
}

export interface SwapPath {
  /** Ordered list of asset IDs from source to destination */
  hops: string[];
  /** Edges traversed in order */
  edges: SwapEdge[];
  /** Total effective cost score (lower is better) */
  totalCost: number;
  /** Expected output amount after all hops */
  expectedOutput: number;
  /** Aggregate fee across all hops */
  totalFeeRate: number;
  /** Aggregate price impact across all hops */
  totalPriceImpact: number;
}

export interface PathFinderOptions {
  /** Maximum number of hops allowed (default 3) */
  maxHops?: number;
  /** Minimum liquidity required at each hop (default 0) */
  minLiquidity?: number;
  /** Maximum number of candidate paths to return (default 5) */
  maxPaths?: number;
}

/**
 * Build an adjacency map from a flat list of edges.
 */
export function buildAdjacencyMap(edges: SwapEdge[]): Map<string, SwapEdge[]> {
  const map = new Map<string, SwapEdge[]>();
  for (const edge of edges) {
    const existing = map.get(edge.from) ?? [];
    existing.push(edge);
    map.set(edge.from, existing);
  }
  return map;
}

/**
 * Compute the effective cost of a single edge.
 * Cost = fee + price impact (both as fractions, summed).
 * Lower cost means a more efficient hop.
 */
export function edgeCost(edge: SwapEdge): number {
  return edge.feeRate + edge.priceImpact;
}

/**
 * Find all viable swap paths from `source` to `destination` up to `maxHops`.
 *
 * Returns paths sorted by totalCost ascending (best first).
 */
export function findAllPaths(
  source: string,
  destination: string,
  adjacencyMap: Map<string, SwapEdge[]>,
  inputAmount: number,
  options: PathFinderOptions = {},
): SwapPath[] {
  const maxHops = options.maxHops ?? 3;
  const minLiquidity = options.minLiquidity ?? 0;
  const maxPaths = options.maxPaths ?? 5;

  const results: SwapPath[] = [];

  interface SearchState {
    currentAsset: string;
    hops: string[];
    edges: SwapEdge[];
    totalCost: number;
    currentAmount: number;
  }

  const queue: SearchState[] = [
    {
      currentAsset: source,
      hops: [source],
      edges: [],
      totalCost: 0,
      currentAmount: inputAmount,
    },
  ];

  while (queue.length > 0) {
    // Pop the lowest-cost state (greedy best-first)
    queue.sort((a, b) => a.totalCost - b.totalCost);
    const state = queue.shift()!;

    if (state.currentAsset === destination && state.edges.length > 0) {
      const totalFeeRate = state.edges.reduce((sum, e) => sum + e.feeRate, 0);
      const totalPriceImpact = state.edges.reduce((sum, e) => sum + e.priceImpact, 0);

      results.push({
        hops: state.hops,
        edges: state.edges,
        totalCost: state.totalCost,
        expectedOutput: state.currentAmount,
        totalFeeRate,
        totalPriceImpact,
      });

      if (results.length >= maxPaths) break;
      continue;
    }

    // Prune: exceeded max hops
    if (state.edges.length >= maxHops) continue;

    const neighbours = adjacencyMap.get(state.currentAsset) ?? [];
    for (const edge of neighbours) {
      // Avoid cycles
      if (state.hops.includes(edge.to)) continue;

      // Liquidity gate
      if (edge.liquidity < minLiquidity) continue;

      const outputAmount = state.currentAmount * edge.exchangeRate * (1 - edge.feeRate);

      queue.push({
        currentAsset: edge.to,
        hops: [...state.hops, edge.to],
        edges: [...state.edges, edge],
        totalCost: state.totalCost + edgeCost(edge),
        currentAmount: outputAmount,
      });
    }
  }

  return results.sort((a, b) => a.totalCost - b.totalCost);
}

/**
 * Select the single best path from a list of candidates.
 * Prefers the path with the lowest total cost; ties broken by highest output.
 */
export function selectBestPath(paths: SwapPath[]): SwapPath | null {
  if (paths.length === 0) return null;

  return paths.reduce((best, candidate) => {
    if (candidate.totalCost < best.totalCost) return candidate;
    if (candidate.totalCost === best.totalCost && candidate.expectedOutput > best.expectedOutput) {
      return candidate;
    }
    return best;
  });
}
