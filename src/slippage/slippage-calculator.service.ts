import { Injectable, Logger } from '@nestjs/common';
import {
  SlippageEstimationDto,
  SlippageEstimateResponseDto,
  SlippageToleranceLevel,
} from './slippage-config.dto';
import { DepthWalkResult, MarketDepth } from './market-depth.types';
import { OrderBookService } from './order-book.service';

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

  // Default slippage tolerances by level
  private readonly TOLERANCE_PRESETS = {
    [SlippageToleranceLevel.STRICT]: 0.1, // 0.1%
    [SlippageToleranceLevel.MODERATE]: 0.5, // 0.5%
    [SlippageToleranceLevel.RELAXED]: 1.0, // 1.0%
  };

  constructor(private readonly orderBookService: OrderBookService) {}

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

      // Caller supplied books are validated too: an empty, crossed or
      // malformed book must never be priced against.
      const depth = marketDepth
        ? this.orderBookService.validateAndNormalise(marketDepth)
        : await this.getMarketDepth(estimationDto.symbol);

      // Walk the correct side of the order book
      const bookWalk = this.calculateExecutionPrice(
        estimationDto.quantity,
        estimationDto.side,
        depth,
      );
      const estimatedExecutionPrice = bookWalk.averagePrice;

      if (bookWalk.insufficientDepth) {
        this.logger.warn(
          `Order exceeds visible depth for ${estimationDto.symbol}: ` +
            `${bookWalk.unfilledQuantity} of ${estimationDto.quantity} unfillable`,
        );
      }

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
        bookWalk.insufficientDepth,
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
   * Calculate execution price based on order book depth by walking the
   * correct side of the book (asks for buys, bids for sells).
   */
  private calculateExecutionPrice(
    quantity: number,
    side: 'buy' | 'sell',
    depth: MarketDepth,
  ): DepthWalkResult {
    return this.orderBookService.walkBook(side, depth, quantity);
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

    if (!Array.isArray(orders) || orders.length === 0 || quantity <= 0) {
      return 0;
    }

    // Calculate total available liquidity in the top N levels
    const topLevels = 10;
    const availableLiquidity = orders
      .slice(0, topLevels)
      .reduce((sum, order) => sum + order.quantity, 0);

    // Calculate spread
    const bestBid = depth.bids[0]?.price || 0;
    const bestAsk = depth.asks[0]?.price || 0;
    const midPrice = (bestBid + bestAsk) / 2;

    // A book without a usable two-sided price cannot be scored.
    if (!Number.isFinite(midPrice) || midPrice <= 0) {
      return 0;
    }

    const spreadPercent = ((bestAsk - bestBid) / midPrice) * 100;

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
    insufficientDepth = false,
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

    // Check order book depth
    if (insufficientDepth) {
      reasons.push('Order exceeds visible order book depth');
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
        reasoning:
          reasons.length > 0
            ? `Market conditions are favorable: ${reasons.join(', ')}`
            : 'Market conditions are favorable with good liquidity',
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
   * Fetch the live order book from the configured market data provider.
   */
  private async getMarketDepth(symbol: string): Promise<MarketDepth> {
    this.logger.debug(`Fetching market depth for ${symbol}`);
    return this.orderBookService.fetchMarketDepth(symbol);
  }

  /**
   * Clear historical data for testing or reset
   */
  clearHistoricalData(symbol?: string): void {
    if (symbol) {
      this.historicalSlippage.delete(symbol);
      this.logger.log(`Cleared historical slippage data for ${symbol}`);
    } else {
      this.historicalSlippage.clear();
      this.logger.log('Cleared all historical slippage data');
    }
  }
}
