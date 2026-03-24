import { LiquidityPoolInfo } from '../interfaces/dex-adapter.interface';

export interface LiquidityAnalysis {
  totalLiquidity: number;
  totalVolume24h: number;
  dominantDex: string;
  liquidityDistribution: LiquidityDistribution[];
  depthScore: number; // 0-100
  concentrationRisk: number; // 0-1, higher = more concentrated
  recommendedMaxTradeSize: number;
}

export interface LiquidityDistribution {
  dexId: string;
  liquidityShare: number; // percentage
  volumeShare: number;
  poolCount: number;
}

export interface SlippageEstimate {
  tradeSize: number;
  estimatedSlippage: number;
  priceImpact: number;
  isExecutable: boolean;
  warningMessage?: string;
}

export class LiquidityAnalyzer {
  /**
   * Analyze aggregated liquidity across all DEXes
   */
  static analyze(allPools: LiquidityPoolInfo[]): LiquidityAnalysis {
    if (!allPools.length) {
      return {
        totalLiquidity: 0,
        totalVolume24h: 0,
        dominantDex: 'none',
        liquidityDistribution: [],
        depthScore: 0,
        concentrationRisk: 1,
        recommendedMaxTradeSize: 0,
      };
    }

    const totalLiquidity = allPools.reduce(
      (sum, p) => sum + p.totalValueLocked,
      0,
    );
    const totalVolume24h = allPools.reduce((sum, p) => sum + p.volume24h, 0);

    // Group by DEX
    const byDex = LiquidityAnalyzer.groupByDex(allPools);
    const distribution = LiquidityAnalyzer.computeDistribution(
      byDex,
      totalLiquidity,
      totalVolume24h,
    );

    const dominantDex = distribution.reduce((a, b) =>
      a.liquidityShare > b.liquidityShare ? a : b,
    ).dexId;

    // Concentration using Herfindahl-Hirschman Index (HHI)
    const hhi = distribution.reduce(
      (sum, d) => sum + Math.pow(d.liquidityShare / 100, 2),
      0,
    );

    const depthScore = Math.min(100, (totalLiquidity / 1_000_000) * 100);
    const recommendedMaxTradeSize = totalLiquidity * 0.01; // 1% of total liquidity

    return {
      totalLiquidity,
      totalVolume24h,
      dominantDex,
      liquidityDistribution: distribution,
      depthScore,
      concentrationRisk: hhi,
      recommendedMaxTradeSize,
    };
  }

  /**
   * Estimate slippage for a given trade size using constant product AMM model
   */
  static estimateSlippage(
    tradeSize: number,
    pool: LiquidityPoolInfo,
  ): SlippageEstimate {
    const reserveIn = parseFloat(pool.reserveA);
    const reserveOut = parseFloat(pool.reserveB);

    if (reserveIn === 0 || reserveOut === 0) {
      return {
        tradeSize,
        estimatedSlippage: 100,
        priceImpact: 100,
        isExecutable: false,
        warningMessage: 'Pool has no liquidity',
      };
    }

    // Constant product formula: x * y = k
    const k = reserveIn * reserveOut;
    const newReserveIn = reserveIn + tradeSize;
    const newReserveOut = k / newReserveIn;
    const amountOut = reserveOut - newReserveOut;

    const spotPrice = reserveOut / reserveIn;
    const executionPrice = amountOut / tradeSize;
    const priceImpact = ((spotPrice - executionPrice) / spotPrice) * 100;
    const feeCost = pool.fee * 100;
    const estimatedSlippage = priceImpact + feeCost;

    const isExecutable = estimatedSlippage < 10; // Reject if >10% slippage

    return {
      tradeSize,
      estimatedSlippage,
      priceImpact,
      isExecutable,
      warningMessage: !isExecutable
        ? `High slippage warning: ${estimatedSlippage.toFixed(2)}%`
        : estimatedSlippage > 2
        ? `Moderate slippage: ${estimatedSlippage.toFixed(2)}%`
        : undefined,
    };
  }

  /**
   * Find optimal split across pools to minimize slippage
   */
  static computeOptimalSplit(
    tradeSize: number,
    pools: LiquidityPoolInfo[],
    maxSplits = 3,
  ): OptimalSplit[] {
    if (!pools.length) return [];

    const sortedByLiquidity = [...pools].sort(
      (a, b) => b.totalValueLocked - a.totalValueLocked,
    );
    const topPools = sortedByLiquidity.slice(0, maxSplits);

    const totalLiquidity = topPools.reduce(
      (sum, p) => sum + p.totalValueLocked,
      0,
    );

    return topPools.map((pool) => {
      const allocationPercent =
        totalLiquidity > 0
          ? (pool.totalValueLocked / totalLiquidity) * 100
          : 100 / topPools.length;
      const allocatedAmount = (tradeSize * allocationPercent) / 100;
      const slippage = LiquidityAnalyzer.estimateSlippage(allocatedAmount, pool);

      return {
        poolId: pool.poolId,
        dexId: pool.dexId,
        allocationPercent,
        allocatedAmount,
        expectedSlippage: slippage.estimatedSlippage,
      };
    });
  }

  private static groupByDex(
    pools: LiquidityPoolInfo[],
  ): Map<string, LiquidityPoolInfo[]> {
    return pools.reduce((map, pool) => {
      const existing = map.get(pool.dexId) || [];
      map.set(pool.dexId, [...existing, pool]);
      return map;
    }, new Map<string, LiquidityPoolInfo[]>());
  }

  private static computeDistribution(
    byDex: Map<string, LiquidityPoolInfo[]>,
    totalLiquidity: number,
    totalVolume: number,
  ): LiquidityDistribution[] {
    return Array.from(byDex.entries()).map(([dexId, pools]) => {
      const dexLiquidity = pools.reduce((s, p) => s + p.totalValueLocked, 0);
      const dexVolume = pools.reduce((s, p) => s + p.volume24h, 0);
      return {
        dexId,
        liquidityShare:
          totalLiquidity > 0 ? (dexLiquidity / totalLiquidity) * 100 : 0,
        volumeShare: totalVolume > 0 ? (dexVolume / totalVolume) * 100 : 0,
        poolCount: pools.length,
      };
    });
  }
}

export interface OptimalSplit {
  poolId: string;
  dexId: string;
  allocationPercent: number;
  allocatedAmount: number;
  expectedSlippage: number;
}
