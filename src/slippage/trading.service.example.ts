import { Injectable, Logger } from '@nestjs/common';
import { SlippageProtectionService } from './slippage-protection.service';
import { SlippageCalculatorService } from './slippage-calculator.service';
import {
  SlippageConfigDto,
  SlippageToleranceLevel,
} from './dto/slippage-config.dto';

/**
 * Example integration showing how to use the slippage module
 * in your trading service to ensure <5s execution with slippage protection
 */
@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);

  constructor(
    private readonly slippageProtection: SlippageProtectionService,
    private readonly slippageCalculator: SlippageCalculatorService,
  ) {}

  /**
   * Execute a trade with slippage protection
   * This demonstrates the complete workflow from estimation to execution to reporting
   */
  async executeTrade(params: {
    userId: string;
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    expectedPrice?: number;
  }) {
    const executionStart = Date.now();

    try {
      // Step 1: Get current market price
      const currentPrice = await this.getCurrentMarketPrice(
        params.symbol,
        params.side,
      );
      const expectedPrice = params.expectedPrice || currentPrice;

      // Step 2: Estimate slippage before execution
      this.logger.log(
        `Estimating slippage for ${params.symbol} ${params.side} order...`,
      );
      
      const estimation = await this.slippageCalculator.estimateSlippage({
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity,
        expectedPrice,
      });

      this.logger.log(
        `Estimated slippage: ${estimation.estimatedSlippagePercent.toFixed(4)}% ` +
        `(liquidity score: ${estimation.liquidityScore.toFixed(2)})`,
      );

      // Step 3: Validate trade against slippage limits
      const validation = await this.slippageProtection.validateTradeExecution({
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity,
        expectedPrice,
        timestamp: new Date(),
        userId: params.userId,
      });

      // Step 4: Reject if slippage too high
      if (!validation.allowed) {
        this.logger.warn(
          `Trade rejected: ${validation.reason}`,
        );
        
        return {
          success: false,
          reason: validation.reason,
          estimatedSlippage: validation.estimatedSlippage,
          maxAllowed: validation.maxAllowedSlippage,
          recommendation: estimation.recommendation,
        };
      }

      // Step 5: Execute the trade
      this.logger.log(
        `Executing ${params.side} order for ${params.quantity} ${params.symbol}...`,
      );
      
      const executionResult = await this.executeMarketOrder({
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity,
      });

      // Step 6: Record actual slippage
      const slippageReport = await this.slippageProtection.recordSlippage(
        {
          symbol: params.symbol,
          side: params.side,
          quantity: params.quantity,
          expectedPrice,
          timestamp: new Date(),
          userId: params.userId,
        },
        executionResult.actualPrice,
      );

      const totalExecutionTime = Date.now() - executionStart;

      this.logger.log(
        `Trade executed successfully in ${totalExecutionTime}ms. ` +
        `Actual slippage: ${slippageReport.slippagePercent.toFixed(4)}% ` +
        `(${slippageReport.withinLimits ? 'within limits' : 'EXCEEDED LIMITS'})`,
      );

      // Ensure we met the <5s requirement
      if (totalExecutionTime > 5000) {
        this.logger.error(
          `EXECUTION TIME EXCEEDED 5s REQUIREMENT: ${totalExecutionTime}ms`,
        );
      }

      return {
        success: true,
        orderId: executionResult.orderId,
        executedPrice: executionResult.actualPrice,
        executionTime: totalExecutionTime,
        slippageReport,
        estimatedSlippage: estimation.estimatedSlippagePercent,
        actualSlippage: slippageReport.slippagePercent,
      };

    } catch (error: any) {
      this.logger.error(
        `Error executing trade for ${params.symbol}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Example: Configure user slippage preferences
   */
  async configureUserSlippagePreferences(
    userId: string,
    toleranceLevel: SlippageToleranceLevel,
    enableDynamic: boolean = true,
  ) {
    const config: SlippageConfigDto = {
      maxSlippagePercent: this.slippageCalculator.getToleranceForLevel(
        toleranceLevel,
      ),
      toleranceLevel,
      enableDynamicSlippage: enableDynamic,
      maxExecutionTimeMs: 5000, // PRD requirement
    };

    this.slippageProtection.setUserPreferences(userId, config);

    this.logger.log(
      `Updated slippage preferences for user ${userId}: ` +
      `${toleranceLevel} (${config.maxSlippagePercent}%)`,
    );
  }

  /**
   * Example: Set symbol-specific slippage limits
   */
  async setSymbolSlippageLimit(
    userId: string,
    symbol: string,
    maxSlippagePercent: number,
  ) {
    const config: SlippageConfigDto = {
      maxSlippagePercent,
      enableDynamicSlippage: true,
      maxExecutionTimeMs: 5000,
    };

    this.slippageProtection.setSymbolOverride(userId, symbol, config);

    this.logger.log(
      `Set ${symbol} slippage limit to ${maxSlippagePercent}% for user ${userId}`,
    );
  }

  /**
   * Example: Get slippage performance report
   */
  async getSlippagePerformanceReport(symbol: string, daysBack: number = 7) {
    const statistics = this.slippageProtection.getSlippageStatistics(
      symbol,
      daysBack,
    );

    const recentReports = this.slippageProtection.getSlippageReports({
      symbol,
      limit: 10,
    });

    return {
      symbol,
      period: `Last ${daysBack} days`,
      statistics: {
        totalTrades: statistics.totalTrades,
        averageSlippage: `${statistics.averageSlippage.toFixed(4)}%`,
        maxSlippage: `${statistics.maxSlippage.toFixed(4)}%`,
        minSlippage: `${statistics.minSlippage.toFixed(4)}%`,
        tradesExceededLimits: statistics.tradesExceededLimits,
        exceedanceRate: statistics.totalTrades > 0
          ? `${((statistics.tradesExceededLimits / statistics.totalTrades) * 100).toFixed(2)}%`
          : 'N/A',
        totalCost: `$${statistics.totalSlippageCost.toFixed(2)}`,
      },
      recentTrades: recentReports.map((r: any) => ({
        timestamp: r.timestamp,
        side: r.side,
        expectedPrice: r.expectedPrice,
        actualPrice: r.actualPrice,
        slippage: `${r.slippagePercent.toFixed(4)}%`,
        cost: `$${r.totalSlippageCost.toFixed(2)}`,
        withinLimits: r.withinLimits,
      })),
    };
  }

  /**
   * Example: Check if a large order should be split due to slippage
   */
  async shouldSplitOrder(
    symbol: string,
    side: 'buy' | 'sell',
    totalQuantity: number,
    maxSlippagePercent: number = 0.5,
  ): Promise<{
    shouldSplit: boolean;
    reason: string;
    recommendedChunkSize?: number;
    estimatedChunks?: number;
  }> {
    // Estimate slippage for full order
    const fullOrderEstimate = await this.slippageCalculator.estimateSlippage({
      symbol,
      side,
      quantity: totalQuantity,
    });

    if (fullOrderEstimate.estimatedSlippagePercent <= maxSlippagePercent) {
      return {
        shouldSplit: false,
        reason: 'Full order within acceptable slippage limits',
      };
    }

    // Binary search for optimal chunk size
    let low = totalQuantity * 0.1; // Start with 10% chunks
    let high = totalQuantity;
    let optimalChunkSize = totalQuantity;

    while (high - low > totalQuantity * 0.05) {
      const mid = (low + high) / 2;
      const estimate = await this.slippageCalculator.estimateSlippage({
        symbol,
        side,
        quantity: mid,
      });

      if (estimate.estimatedSlippagePercent <= maxSlippagePercent) {
        optimalChunkSize = mid;
        low = mid;
      } else {
        high = mid;
      }
    }

    const chunks = Math.ceil(totalQuantity / optimalChunkSize);

    return {
      shouldSplit: true,
      reason: `Full order would exceed slippage limit (${fullOrderEstimate.estimatedSlippagePercent.toFixed(4)}% > ${maxSlippagePercent}%)`,
      recommendedChunkSize: optimalChunkSize,
      estimatedChunks: chunks,
    };
  }

  /**
   * Mock method - replace with actual exchange integration
   */
  private async getCurrentMarketPrice(
    _symbol: string,
    _side: 'buy' | 'sell',
  ): Promise<number> {
    // TODO: Integrate with your exchange API
    return 45000;
  }

  /**
   * Mock method - replace with actual order execution
   */
  private async executeMarketOrder(params: {
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
  }): Promise<{ orderId: string; actualPrice: number }> {
    // TODO: Integrate with your exchange API
    // Simulate order execution with some slippage
    const basePrice = 45000;
    const slippagePercent = Math.random() * 0.3; // 0-0.3% random slippage
    const slippageFactor = params.side === 'buy' 
      ? 1 + (slippagePercent / 100) 
      : 1 - (slippagePercent / 100);
    
    return {
      orderId: `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      actualPrice: basePrice * slippageFactor,
    };
  }
}