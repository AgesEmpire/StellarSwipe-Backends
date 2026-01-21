import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SlippageCalculatorService } from './slippage-calculator.service';
import {
  SlippageConfigDto,
  SlippageReportDto,
  SlippageToleranceLevel,
} from './dto/slippage-config.dto';

interface TradeExecutionContext {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  expectedPrice: number;
  timestamp: Date;
  userId?: string;
  orderId?: string;
}

interface SlippageProtectionResult {
  allowed: boolean;
  reason: string;
  estimatedSlippage: number;
  maxAllowedSlippage: number;
  recommendation: 'proceed' | 'caution' | 'reject';
}

interface UserSlippagePreferences {
  userId: string;
  defaultConfig: SlippageConfigDto;
  symbolOverrides?: Map<string, SlippageConfigDto>;
  lastUpdated: Date;
}

@Injectable()
export class SlippageProtectionService {
  private readonly logger = new Logger(SlippageProtectionService.name);
  private readonly userPreferences = new Map<string, UserSlippagePreferences>();
  
  // Default configuration
  private readonly DEFAULT_CONFIG: SlippageConfigDto = {
    maxSlippagePercent: 0.5,
    toleranceLevel: SlippageToleranceLevel.MODERATE,
    enableDynamicSlippage: true,
    maxExecutionTimeMs: 5000, // PRD requirement: <5s execution
  };

  // Slippage reports storage (in production, use a database)
  private readonly slippageReports: SlippageReportDto[] = [];
  private readonly MAX_REPORTS_IN_MEMORY = 1000;

  constructor(
    private readonly slippageCalculator: SlippageCalculatorService,
  ) {}

  /**
   * Pre-execution check - validates if trade should proceed based on slippage
   */
  async validateTradeExecution(
    context: TradeExecutionContext,
    userConfig?: SlippageConfigDto,
  ): Promise<SlippageProtectionResult> {
    const startTime = Date.now();
    
    try {
      // Get applicable configuration
      const config = this.getApplicableConfig(
        context.userId,
        context.symbol,
        userConfig,
      );

      // Check if execution time is about to exceed limit
      this.validateExecutionTiming(startTime, config.maxExecutionTimeMs);

      // Estimate slippage
      const estimation = await this.slippageCalculator.estimateSlippage({
        symbol: context.symbol,
        side: context.side,
        quantity: context.quantity,
        expectedPrice: context.expectedPrice,
      });

      // Determine max allowed slippage
      const maxAllowedSlippage = this.calculateMaxAllowedSlippage(
        config,
        estimation.liquidityScore,
      );

      // Check if slippage is within limits
      const isWithinLimits = estimation.estimatedSlippagePercent <= maxAllowedSlippage;

      // Generate result
      const result = this.generateProtectionResult(
        estimation.estimatedSlippagePercent,
        maxAllowedSlippage,
        estimation.recommendation,
        isWithinLimits,
      );

      const executionTime = Date.now() - startTime;
      
      this.logger.log(
        `Slippage validation for ${context.symbol}: ` +
        `${result.allowed ? 'ALLOWED' : 'REJECTED'} ` +
        `(${estimation.estimatedSlippagePercent.toFixed(4)}% vs ${maxAllowedSlippage.toFixed(4)}% max) ` +
        `in ${executionTime}ms`,
      );

      // Ensure total execution stays under limit
      if (executionTime > (config.maxExecutionTimeMs || 5000) * 0.8) {
        this.logger.warn(
          `Slippage validation approaching time limit: ${executionTime}ms`,
        );
      }

      return result;
    } catch (error: any) {
      this.logger.error(
        `Error validating trade execution for ${context.symbol}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Post-execution reporting - records actual slippage
   */
  async recordSlippage(
    context: TradeExecutionContext,
    actualExecutionPrice: number,
  ): Promise<SlippageReportDto> {
    const { expectedPrice, quantity, symbol, side } = context;

    // Calculate actual slippage
    const slippage = this.slippageCalculator.calculateActualSlippage(
      expectedPrice,
      actualExecutionPrice,
      quantity,
    );

    // Get applicable config to check limits
    const config = this.getApplicableConfig(context.userId, symbol);
    const maxAllowed = config.maxSlippagePercent;
    const withinLimits = slippage.slippagePercent <= maxAllowed;

    // Create report
    const report: SlippageReportDto = {
      expectedPrice,
      actualPrice: actualExecutionPrice,
      slippageAmount: slippage.slippageAmount,
      slippagePercent: slippage.slippagePercent,
      quantity,
      totalSlippageCost: slippage.totalCost,
      withinLimits,
      timestamp: new Date(),
      symbol,
      side,
    };

    // Store report
    this.storeReport(report);

    // Update historical data
    this.slippageCalculator.updateHistoricalSlippage(
      symbol,
      slippage.slippagePercent,
    );

    // Log warning if slippage exceeded limits
    if (!withinLimits) {
      this.logger.warn(
        `Slippage exceeded limits for ${symbol}: ` +
        `${slippage.slippagePercent.toFixed(4)}% (max: ${maxAllowed}%)`,
      );
    }

    this.logger.log(
      `Recorded slippage for ${symbol}: ${slippage.slippagePercent.toFixed(4)}% ` +
      `(cost: ${slippage.totalCost.toFixed(2)})`,
    );

    return report;
  }

  /**
   * Set user slippage preferences
   */
  setUserPreferences(
    userId: string,
    config: SlippageConfigDto,
    symbolOverrides?: Map<string, SlippageConfigDto>,
  ): void {
    this.validateConfig(config);

    if (symbolOverrides) {
      symbolOverrides.forEach((override) => this.validateConfig(override));
    }

    this.userPreferences.set(userId, {
      userId,
      defaultConfig: config,
      symbolOverrides,
      lastUpdated: new Date(),
    });

    this.logger.log(`Updated slippage preferences for user ${userId}`);
  }

  /**
   * Get user slippage preferences
   */
  getUserPreferences(userId: string): UserSlippagePreferences | undefined {
    return this.userPreferences.get(userId);
  }

  /**
   * Set symbol-specific override for a user
   */
  setSymbolOverride(
    userId: string,
    symbol: string,
    config: SlippageConfigDto,
  ): void {
    this.validateConfig(config);

    const existing = this.userPreferences.get(userId);
    const overrides = existing?.symbolOverrides || new Map();
    overrides.set(symbol, config);

    this.userPreferences.set(userId, {
      userId,
      defaultConfig: existing?.defaultConfig || this.DEFAULT_CONFIG,
      symbolOverrides: overrides,
      lastUpdated: new Date(),
    });

    this.logger.log(
      `Set symbol override for ${symbol} (user: ${userId})`,
    );
  }

  /**
   * Get slippage reports with filtering
   */
  getSlippageReports(filters?: {
    symbol?: string;
    startDate?: Date;
    endDate?: Date;
    onlyExceeded?: boolean;
    limit?: number;
  }): SlippageReportDto[] {
    let reports = [...this.slippageReports];

    if (filters?.symbol) {
      reports = reports.filter(r => r.symbol === filters.symbol);
    }

    if (filters?.startDate) {
      const startDate = filters.startDate;
      reports = reports.filter(r => r.timestamp >= startDate);
    }
    
    if (filters?.endDate) {
      const endDate = filters.endDate;
      reports = reports.filter(r => r.timestamp <= endDate);
    }

    if (filters?.onlyExceeded) {
      reports = reports.filter(r => !r.withinLimits);
    }

    // Sort by timestamp descending
    reports.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filters?.limit) {
      reports = reports.slice(0, filters.limit);
    }

    return reports;
  }

  /**
   * Get slippage statistics for a symbol
   */
  getSlippageStatistics(symbol: string, daysBack: number = 7): {
    averageSlippage: number;
    maxSlippage: number;
    minSlippage: number;
    totalTrades: number;
    tradesExceededLimits: number;
    totalSlippageCost: number;
  } {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    const relevantReports = this.slippageReports.filter(
      r => r.symbol === symbol && r.timestamp >= cutoffDate,
    );

    if (relevantReports.length === 0) {
      return {
        averageSlippage: 0,
        maxSlippage: 0,
        minSlippage: 0,
        totalTrades: 0,
        tradesExceededLimits: 0,
        totalSlippageCost: 0,
      };
    }

    const slippages = relevantReports.map(r => r.slippagePercent);
    const sum = slippages.reduce((a, b) => a + b, 0);

    return {
      averageSlippage: sum / slippages.length,
      maxSlippage: Math.max(...slippages),
      minSlippage: Math.min(...slippages),
      totalTrades: relevantReports.length,
      tradesExceededLimits: relevantReports.filter(r => !r.withinLimits).length,
      totalSlippageCost: relevantReports.reduce(
        (sum, r) => sum + r.totalSlippageCost,
        0,
      ),
    };
  }

  /**
   * Get applicable configuration for a trade
   */
  private getApplicableConfig(
    userId?: string,
    symbol?: string,
    override?: SlippageConfigDto,
  ): SlippageConfigDto {
    // Priority: override > symbol-specific > user default > system default
    if (override) {
      return override;
    }

    if (userId) {
      const userPrefs = this.userPreferences.get(userId);
      if (userPrefs) {
        if (symbol && userPrefs.symbolOverrides?.has(symbol)) {
          return userPrefs.symbolOverrides.get(symbol)!;
        }
        return userPrefs.defaultConfig;
      }
    }

    return this.DEFAULT_CONFIG;
  }

  /**
   * Calculate maximum allowed slippage with dynamic adjustment
   */
  private calculateMaxAllowedSlippage(
    config: SlippageConfigDto,
    liquidityScore: number,
  ): number {
    let maxSlippage = config.maxSlippagePercent;

    // Apply dynamic slippage if enabled
    if (config.enableDynamicSlippage) {
      // Estimate market volatility (simplified - in production use actual volatility)
      const estimatedVolatility = 1.0; // TODO: Replace with actual volatility calculation

      maxSlippage = this.slippageCalculator.calculateDynamicTolerance(
        config.maxSlippagePercent,
        liquidityScore,
        estimatedVolatility,
      );
    }

    return maxSlippage;
  }

  /**
   * Generate protection result based on analysis
   */
  private generateProtectionResult(
    estimatedSlippage: number,
    maxAllowed: number,
    recommendation: 'proceed' | 'caution' | 'delay',
    isWithinLimits: boolean,
  ): SlippageProtectionResult {
    if (!isWithinLimits || recommendation === 'delay') {
      return {
        allowed: false,
        reason: `Estimated slippage (${estimatedSlippage.toFixed(4)}%) exceeds maximum allowed (${maxAllowed.toFixed(4)}%)`,
        estimatedSlippage,
        maxAllowedSlippage: maxAllowed,
        recommendation: 'reject',
      };
    }

    if (recommendation === 'caution') {
      return {
        allowed: true,
        reason: `Trade allowed with caution - slippage near upper limit`,
        estimatedSlippage,
        maxAllowedSlippage: maxAllowed,
        recommendation: 'caution',
      };
    }

    return {
      allowed: true,
      reason: 'Trade within acceptable slippage limits',
      estimatedSlippage,
      maxAllowedSlippage: maxAllowed,
      recommendation: 'proceed',
    };
  }

  /**
   * Validate configuration
   */
  private validateConfig(config: SlippageConfigDto): void {
    if (config.maxSlippagePercent < 0 || config.maxSlippagePercent > 100) {
      throw new BadRequestException(
        'maxSlippagePercent must be between 0 and 100',
      );
    }

    if (config.maxExecutionTimeMs && config.maxExecutionTimeMs < 100) {
      throw new BadRequestException(
        'maxExecutionTimeMs must be at least 100ms',
      );
    }
  }

  /**
   * Validate execution timing
   */
  private validateExecutionTiming(
    startTime: number,
    maxExecutionTimeMs: number = 5000,
  ): void {
    const elapsed = Date.now() - startTime;
    const threshold = maxExecutionTimeMs * 0.9; // 90% of max time

    if (elapsed > threshold) {
      this.logger.warn(
        `Execution time approaching limit: ${elapsed}ms / ${maxExecutionTimeMs}ms`,
      );
    }
  }

  /**
   * Store slippage report
   */
  private storeReport(report: SlippageReportDto): void {
    this.slippageReports.push(report);

    // Trim old reports if exceeding memory limit
    if (this.slippageReports.length > this.MAX_REPORTS_IN_MEMORY) {
      const toRemove = this.slippageReports.length - this.MAX_REPORTS_IN_MEMORY;
      this.slippageReports.splice(0, toRemove);
      this.logger.debug(`Trimmed ${toRemove} old slippage reports`);
    }
  }

  /**
   * Clear all user preferences (for testing)
   */
  clearUserPreferences(userId?: string): void {
    if (userId) {
      this.userPreferences.delete(userId);
      this.logger.log(`Cleared preferences for user ${userId}`);
    } else {
      this.userPreferences.clear();
      this.logger.log('Cleared all user preferences');
    }
  }

  /**
   * Clear slippage reports (for testing)
   */
  clearReports(): void {
    this.slippageReports.length = 0;
    this.logger.log('Cleared all slippage reports');
  }

  /**
   * Export slippage data for analysis
   */
  exportSlippageData(symbol?: string): {
    reports: SlippageReportDto[];
    statistics: any;
  } {
    const reports = symbol
      ? this.slippageReports.filter(r => r.symbol === symbol)
      : this.slippageReports;

    const statistics = symbol
      ? this.getSlippageStatistics(symbol, 30)
      : null;

    return {
      reports,
      statistics,
    };
  }
}