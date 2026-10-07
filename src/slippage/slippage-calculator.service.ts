import { Injectable, Logger } from '@nestjs/common';
import {
  SlippageEstimationDto,
  SlippageEstimateResponseDto,
  SlippageToleranceLevel,
} from './slippage-config.dto';
export interface MarketPriceObservation {
  price: number;
  timestamp: Date | number | string;
}

export interface VolatilityCalculationOptions {
  /**
   * Minimum number of valid price observations required to compute volatility.
   * If fewer than this number are available, fallbackVolatility is returned.
   * Default: 3
   */
  minSampleSize?: number;

  /**
   * Maximum allowed age in milliseconds for the latest observation relative to referenceTime.
   * If the latest observation is older than this value, observations are considered stale.
   * Default: 3600000 (1 hour)
   */
  maxObservationAgeMs?: number;

  /**
   * Fallback volatility percentage returned when observations are insufficient, stale, or invalid.
   * Default: 1.0
   */
  fallbackVolatility?: number;

  /**
   * Reference time used to determine staleness. Defaults to Date.now().
   */
  referenceTime?: Date | number;
}

/**
 * Calculates historical price volatility based on market observations.
 *
 * Implements deterministic calculation using sample standard deviation of
 * period-to-period price returns:
 * 1. Input validation & filtering: filters null, undefined, NaN, non-finite, and non-positive prices.
 * 2. Minimum sample rule: requires at least `minSampleSize` observations (default: 3).
 * 3. Stale-data rule: verifies observations are within `maxObservationAgeMs` of `referenceTime`.
 * 4. Deterministic for a known price series: computes deterministic sample standard deviation of returns.
 * 5. Flat series: returns 0.0 when all prices are identical.
 */
export function calculateHistoricalVolatility(
  observations?: Array<MarketPriceObservation | number> | null,
  options?: VolatilityCalculationOptions,
): number {
  const minSampleSize = options?.minSampleSize ?? 3;
  const maxObservationAgeMs = options?.maxObservationAgeMs ?? 3_600_000; // 1 hour
  const fallbackVolatility = options?.fallbackVolatility ?? 1.0;
  const refTime =
    options?.referenceTime !== undefined
      ? options.referenceTime instanceof Date
        ? options.referenceTime.getTime()
        : Number(options.referenceTime)
      : Date.now();

  if (!Array.isArray(observations) || observations.length === 0) {
    return fallbackVolatility;
  }

  // Parse and filter valid price observations
  const validObservations: Array<{ price: number; timestamp: number }> = [];

  for (const obs of observations) {
    if (obs === null || obs === undefined) continue;

    let price: number;
    let timestamp: number;

    if (typeof obs === 'number') {
      price = obs;
      timestamp = refTime;
    } else if (typeof obs === 'object') {
      price = Number(obs.price);
      if (obs.timestamp instanceof Date) {
        timestamp = obs.timestamp.getTime();
      } else if (typeof obs.timestamp === 'number') {
        timestamp = obs.timestamp;
      } else if (typeof obs.timestamp === 'string') {
        timestamp = new Date(obs.timestamp).getTime();
      } else {
        timestamp = refTime;
      }
    } else {
      continue;
    }

    if (
      typeof price === 'number' &&
      isFinite(price) &&
      !isNaN(price) &&
      price > 0 &&
      !isNaN(timestamp)
    ) {
      validObservations.push({ price, timestamp });
    }
  }

  // Minimum sample check
  if (validObservations.length < minSampleSize) {
    return fallbackVolatility;
  }

  // Sort chronologically ascending
  validObservations.sort((a, b) => a.timestamp - b.timestamp);

  // Stale-data rule: check the latest observation age against referenceTime
  const latestTimestamp = validObservations[validObservations.length - 1].timestamp;
  const ageOfLatest = refTime - latestTimestamp;

  if (ageOfLatest > maxObservationAgeMs || ageOfLatest < -60_000) {
    return fallbackVolatility;
  }

  // Filter observations to only those within acceptable window [refTime - maxObservationAgeMs, refTime + 60_000]
  const windowObservations = validObservations.filter(
    (obs) =>
      obs.timestamp >= refTime - maxObservationAgeMs &&
      obs.timestamp <= refTime + 60_000,
  );

  if (windowObservations.length < minSampleSize) {
    return fallbackVolatility;
  }

  const prices = windowObservations.map((obs) => obs.price);

  // Check for flat series (all prices identical within tolerance)
  const firstPrice = prices[0];
  const isFlat = prices.every((p) => Math.abs(p - firstPrice) < 1e-9);
  if (isFlat) {
    return 0.0;
  }

  // Calculate percentage returns between adjacent periods: (P_i - P_{i-1}) / P_{i-1} * 100
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    const ret = ((curr - prev) / prev) * 100;
    returns.push(ret);
  }

  if (returns.length === 0) {
    return 0.0;
  }

  // Compute sample standard deviation of returns
  const mean = returns.reduce((acc, val) => acc + val, 0) / returns.length;
  const sumSquaredDiff = returns.reduce(
    (acc, val) => acc + Math.pow(val - mean, 2),
    0,
  );

  const divisor = returns.length > 1 ? returns.length - 1 : 1;
  const variance = sumSquaredDiff / divisor;
  const stdDev = Math.sqrt(variance);

  return Math.round(stdDev * 10000) / 10000;
}

interface MarketDepth {
  bids: Array<{ price: number; quantity: number }>;
  asks: Array<{ price: number; quantity: number }>;
  timestamp: Date;
}

interface HistoricalSlippage {
  symbol: string;
  averageSlippage: number;
  maxSlippage: number;
  sampleCount: number;
  lastUpdated: Date;
}

@Injectable()
export class SlippageCalculatorService {
  private readonly logger = new Logger(SlippageCalculatorService.name);
  private readonly historicalSlippage = new Map<string, HistoricalSlippage>();
  private readonly historicalObservations = new Map<string, MarketPriceObservation[]>();

  // Default slippage tolerances by level
  private readonly TOLERANCE_PRESETS = {
    [SlippageToleranceLevel.STRICT]: 0.1, // 0.1%
    [SlippageToleranceLevel.MODERATE]: 0.5, // 0.5%
    [SlippageToleranceLevel.RELAXED]: 1.0, // 1.0%
  };

  /**
   * Estimate slippage before trade execution
   */
  async estimateSlippage(
    estimationDto: SlippageEstimationDto,
    marketDepth?: MarketDepth,
  ): Promise<SlippageEstimateResponseDto> {
    const startTime = Date.now();

    try {
      // Get current market price and depth
      const currentPrice = await this.getCurrentMarketPrice(
        estimationDto.symbol,
        estimationDto.side,
      );

      const depth =
        marketDepth || (await this.getMarketDepth(estimationDto.symbol));

      // Calculate estimated execution price based on order book
      const estimatedExecutionPrice = this.calculateExecutionPrice(
        estimationDto.quantity,
        estimationDto.side,
        depth,
      );

      // Calculate slippage
      const expectedPrice = estimationDto.expectedPrice || currentPrice;
      const slippageAmount = Math.abs(estimatedExecutionPrice - expectedPrice);
      const slippagePercent = (slippageAmount / expectedPrice) * 100;

      // Calculate liquidity score
      const liquidityScore = this.calculateLiquidityScore(
        depth,
        estimationDto.quantity,
        estimationDto.side,
      );

      // Get historical data for this symbol
      const historical = this.getHistoricalSlippage(estimationDto.symbol);

      // Determine price range
      const priceRange = this.calculatePriceRange(
        expectedPrice,
        slippagePercent,
        historical,
      );

      // Generate recommendation
      const { recommendation, reasoning } = this.generateRecommendation(
        slippagePercent,
        liquidityScore,
        historical,
      );

      const executionTime = Date.now() - startTime;
      this.logger.debug(
        `Slippage estimation completed in ${executionTime}ms for ${estimationDto.symbol}`,
      );

      return {
        estimatedSlippagePercent: slippagePercent,
        estimatedSlippageAmount: slippageAmount,
        currentMarketPrice: currentPrice,
        estimatedPriceRange: priceRange,
        liquidityScore,
        recommendation,
        reasoning,
      };
    } catch (error: any) {
      this.logger.error(
        `Error estimating slippage for ${estimationDto.symbol}`,
        // error instanceof Error ? error.stack : String(error),

        (error as Error).stack,
      );
      throw error;
    }
  }

  /**
   * Calculate actual slippage after trade execution
   */
  calculateActualSlippage(
    expectedPrice: number,
    actualPrice: number,
    quantity: number,
  ): {
    slippageAmount: number;
    slippagePercent: number;
    totalCost: number;
  } {
    const slippageAmount = Math.abs(actualPrice - expectedPrice);
    const slippagePercent = (slippageAmount / expectedPrice) * 100;
    const totalCost = slippageAmount * quantity;

    return {
      slippageAmount,
      slippagePercent,
      totalCost,
    };
  }

  /**
   * Calculate execution price based on order book depth
   */
  private calculateExecutionPrice(
    quantity: number,
    side: 'buy' | 'sell',
    depth: MarketDepth,
  ): number {
    const orders = side === 'buy' ? depth.asks : depth.bids;

    let remainingQuantity = quantity;
    let totalCost = 0;
    let executedQuantity = 0;

    for (const order of orders) {
      if (remainingQuantity <= 0) break;

      const fillQuantity = Math.min(remainingQuantity, order.quantity);
      totalCost += fillQuantity * order.price;
      executedQuantity += fillQuantity;
      remainingQuantity -= fillQuantity;
    }

    // If we couldn't fill the entire order, estimate remaining at worst price
    if (remainingQuantity > 0 && orders.length > 0) {
      const worstPrice = orders[orders.length - 1].price;
      totalCost += remainingQuantity * worstPrice * 1.02; // Add 2% penalty for liquidity
      executedQuantity += remainingQuantity;
    }

    return executedQuantity > 0 ? totalCost / executedQuantity : 0;
  }

  /**
   * Calculate liquidity score based on order book depth
   */
  private calculateLiquidityScore(
    depth: MarketDepth,
    quantity: number,
    side: 'buy' | 'sell',
  ): number {
    const orders = side === 'buy' ? depth.asks : depth.bids;

    // Calculate total available liquidity in the top N levels
    const topLevels = 10;
    const availableLiquidity = orders
      .slice(0, topLevels)
      .reduce((sum, order) => sum + order.quantity, 0);

    // Calculate spread
    const bestBid = depth.bids[0]?.price || 0;
    const bestAsk = depth.asks[0]?.price || 0;
    const midPrice = (bestBid + bestAsk) / 2;
    const spreadPercent =
      midPrice > 0 ? ((bestAsk - bestBid) / midPrice) * 100 : 100;

    // Score factors:
    // 1. Liquidity coverage (how much of order can be filled in top levels)
    const liquidityCoverage = Math.min(availableLiquidity / quantity, 1);

    // 2. Spread tightness (lower spread = better)
    const spreadScore = Math.max(0, 1 - spreadPercent / 2); // Normalize to 0-1

    // 3. Order book depth (number of price levels)
    const depthScore = Math.min(orders.length / 20, 1);

    // Weighted average
    const score =
      liquidityCoverage * 0.5 + spreadScore * 0.3 + depthScore * 0.2;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate expected price range
   */
  private calculatePriceRange(
    expectedPrice: number,
    estimatedSlippagePercent: number,
    historical?: HistoricalSlippage,
  ): { min: number; max: number } {
    // Use the higher of estimated or historical average slippage
    let slippagePercent = estimatedSlippagePercent;

    if (historical && historical.averageSlippage > estimatedSlippagePercent) {
      slippagePercent = historical.averageSlippage;
    }

    // Add a safety margin
    const safetyMargin = 1.2; // 20% buffer
    const rangePercent = slippagePercent * safetyMargin;

    return {
      min: expectedPrice * (1 - rangePercent / 100),
      max: expectedPrice * (1 + rangePercent / 100),
    };
  }

  /**
   * Generate recommendation based on market conditions
   */
  private generateRecommendation(
    estimatedSlippage: number,
    liquidityScore: number,
    historical?: HistoricalSlippage,
  ): { recommendation: 'proceed' | 'caution' | 'delay'; reasoning: string } {
    const reasons: string[] = [];

    // Check slippage levels
    if (estimatedSlippage > 1.0) {
      reasons.push(
        `High estimated slippage (${estimatedSlippage.toFixed(2)}%)`,
      );
    }

    // Check liquidity
    if (liquidityScore < 0.3) {
      reasons.push('Low market liquidity');
    } else if (liquidityScore < 0.6) {
      reasons.push('Moderate market liquidity');
    }

    // Check historical patterns
    if (historical && estimatedSlippage > historical.averageSlippage * 2) {
      reasons.push('Slippage significantly higher than historical average');
    }

    // Determine recommendation
    if (estimatedSlippage > 2.0 || liquidityScore < 0.3) {
      return {
        recommendation: 'delay',
        reasoning: `Consider delaying trade: ${reasons.join(', ')}`,
      };
    } else if (estimatedSlippage > 0.5 || liquidityScore < 0.6) {
      return {
        recommendation: 'caution',
        reasoning: `Proceed with caution: ${reasons.join(', ')}`,
      };
    } else {
      return {
        recommendation: 'proceed',
        reasoning: 'Market conditions are favorable with good liquidity',
      };
    }
  }

  /**
   * Update historical slippage data
   */
  updateHistoricalSlippage(symbol: string, actualSlippage: number): void {
    const existing = this.historicalSlippage.get(symbol);

    if (existing) {
      // Update running average
      const newCount = existing.sampleCount + 1;
      const newAverage =
        (existing.averageSlippage * existing.sampleCount + actualSlippage) /
        newCount;
      const newMax = Math.max(existing.maxSlippage, actualSlippage);

      this.historicalSlippage.set(symbol, {
        symbol,
        averageSlippage: newAverage,
        maxSlippage: newMax,
        sampleCount: newCount,
        lastUpdated: new Date(),
      });
    } else {
      this.historicalSlippage.set(symbol, {
        symbol,
        averageSlippage: actualSlippage,
        maxSlippage: actualSlippage,
        sampleCount: 1,
        lastUpdated: new Date(),
      });
    }

    this.logger.debug(
      `Updated historical slippage for ${symbol}: ${actualSlippage.toFixed(4)}%`,
    );
  }

  /**
   * Get historical slippage data for a symbol
   */
  private getHistoricalSlippage(
    symbol: string,
  ): HistoricalSlippage | undefined {
    return this.historicalSlippage.get(symbol);
  }

  /**
   * Get slippage tolerance for a given level
   */
  getToleranceForLevel(level: SlippageToleranceLevel): number {
    return this.TOLERANCE_PRESETS[level];
  }

  /**
   * Calculate dynamic slippage tolerance based on market conditions
   */
  calculateDynamicTolerance(
    baseTolerancePercent: number,
    liquidityScore: number,
    volatility: number,
  ): number {
    // Increase tolerance in low liquidity conditions
    const liquidityAdjustment = liquidityScore < 0.5 ? 1 - liquidityScore : 0;

    // Increase tolerance during high volatility
    const volatilityAdjustment = volatility > 2.0 ? volatility / 10 : 0;

    // Calculate adjusted tolerance (max 3x base tolerance)
    const adjustedTolerance = Math.min(
      baseTolerancePercent * (1 + liquidityAdjustment + volatilityAdjustment),
      baseTolerancePercent * 3,
    );

    return adjustedTolerance;
  }

  /**
   * Mock method - replace with actual market data provider
   */
  private async getCurrentMarketPrice(
    symbol: string,
    _side: 'buy' | 'sell',
  ): Promise<number> {
    // TODO: Replace with actual market data provider integration
    // This is a placeholder that should connect to your exchange API
    this.logger.debug(`Fetching current market price for ${symbol}`);

    // Simulated price - replace with real implementation
    return 45000.0;
  }

  /**
   * Mock method - replace with actual order book provider
   */
  private async getMarketDepth(symbol: string): Promise<MarketDepth> {
    // TODO: Replace with actual order book data from exchange
    // This is a placeholder that should connect to your exchange API
    this.logger.debug(`Fetching market depth for ${symbol}`);

    // Simulated order book - replace with real implementation
    return {
      bids: Array.from({ length: 20 }, (_, i) => ({
        price: 45000 - i * 10,
        quantity: 0.5 + Math.random() * 2,
      })),
      asks: Array.from({ length: 20 }, (_, i) => ({
        price: 45000 + i * 10,
        quantity: 0.5 + Math.random() * 2,
      })),
      timestamp: new Date(),
    };
  }

  /**
   * Add a market observation for a specific trading symbol.
   */
  addMarketObservation(
    symbol: string,
    price: number,
    timestamp: Date | number | string = new Date(),
  ): void {
    const list = this.historicalObservations.get(symbol) ?? [];
    list.push({ price, timestamp });
    if (list.length > 500) {
      list.splice(0, list.length - 500);
    }
    this.historicalObservations.set(symbol, list);
  }

  /**
   * Get recorded market observations for a symbol.
   */
  getMarketObservations(symbol: string): MarketPriceObservation[] {
    return this.historicalObservations.get(symbol) ?? [];
  }

  /**
   * Calculate historical volatility for a provided price observation series.
   */
  calculateVolatility(
    observations?: Array<MarketPriceObservation | number> | null,
    options?: VolatilityCalculationOptions,
  ): number {
    return calculateHistoricalVolatility(observations, options);
  }

  /**
   * Calculate historical volatility for a tracked symbol using in-memory observations.
   */
  calculateVolatilityForSymbol(
    symbol: string,
    options?: VolatilityCalculationOptions,
  ): number {
    const observations = this.getMarketObservations(symbol);
    return this.calculateVolatility(observations, options);
  }

  /**
   * Clear historical data for testing or reset
   */
  clearHistoricalData(symbol?: string): void {
    if (symbol) {
      this.historicalSlippage.delete(symbol);
      this.historicalObservations.delete(symbol);
      this.logger.log(`Cleared historical slippage data for ${symbol}`);
    } else {
      this.historicalSlippage.clear();
      this.historicalObservations.clear();
      this.logger.log('Cleared all historical slippage data');
    }
  }
}
