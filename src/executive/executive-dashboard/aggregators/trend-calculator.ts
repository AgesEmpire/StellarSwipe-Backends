import { Injectable } from '@nestjs/common';

/**
 * Trend Calculator
 * Calculates trends and growth rates for metrics
 */
@Injectable()
export class TrendCalculator {
  /**
   * Calculate percentage change between two values
   */
  calculatePercentageChange(current: number, previous: number): number {
    if (previous === 0) {
      return current === 0 ? 0 : 100;
    }
    return ((current - previous) / Math.abs(previous)) * 100;
  }

  /**
   * Calculate moving average
   */
  calculateMovingAverage(values: number[], windowSize: number): number[] {
    const result: number[] = [];
    
    for (let i = 0; i <= values.length - windowSize; i++) {
      const window = values.slice(i, i + windowSize);
      const sum = window.reduce((a, b) => a + b, 0);
      result.push(sum / windowSize);
    }
    
    return result;
  }

  /**
   * Calculate trend direction
   */
  calculateTrendDirection(
    current: number,
    previous: number,
  ): 'up' | 'down' | 'stable' {
    const changePercent = this.calculatePercentageChange(current, previous);
    
    if (changePercent > 2) return 'up';
    if (changePercent < -2) return 'down';
    return 'stable';
  }

  /**
   * Calculate compound growth rate
   */
  calculateCompoundGrowthRate(
    startValue: number,
    endValue: number,
    periods: number,
  ): number {
    if (startValue <= 0 || endValue <= 0) return 0;
    
    const ratio = endValue / startValue;
    return (Math.pow(ratio, 1 / periods) - 1) * 100;
  }

  /**
   * Calculate growth acceleration
   * Shows if growth rate is increasing or decreasing
   */
  calculateGrowthAcceleration(
    growthRates: number[],
  ): 'accelerating' | 'decelerating' | 'stable' {
    if (growthRates.length < 2) return 'stable';
    
    const recentGrowth = growthRates[growthRates.length - 1];
    const previousGrowth = growthRates[growthRates.length - 2];
    
    const acceleration = recentGrowth - previousGrowth;
    
    if (acceleration > 1) return 'accelerating';
    if (acceleration < -1) return 'decelerating';
    return 'stable';
  }

  /**
   * Forecast next value using linear regression
   */
  forecastLinearRegression(values: number[], forecastPeriods: number = 1): number[] {
    if (values.length < 2) return values;
    
    const n = values.length;
    const sumX = (n * (n + 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((sum, y, x) => sum + (x + 1) * y, 0);
    const sumX2 = (n * (n + 1) * (2 * n + 1)) / 6;
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    const forecast: number[] = [];
    
    for (let i = 1; i <= forecastPeriods; i++) {
      const predictedValue = slope * (n + i) + intercept;
      forecast.push(Math.max(0, predictedValue)); // Ensure non-negative
    }
    
    return forecast;
  }

  /**
   * Calculate volatility (standard deviation)
   */
  calculateVolatility(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
    
    return Math.sqrt(variance);
  }

  /**
   * Identify anomalies using z-score method
   */
  detectAnomalies(values: number[], threshold: number = 2): number[] {
    if (values.length === 0) return [];
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = this.calculateVolatility(values);
    
    if (stdDev === 0) return [];
    
    const anomalyIndices: number[] = [];
    
    values.forEach((value, index) => {
      const zScore = Math.abs((value - mean) / stdDev);
      if (zScore > threshold) {
        anomalyIndices.push(index);
      }
    });
    
    return anomalyIndices;
  }

  /**
   * Calculate success rate with confidence interval
   */
  calculateSuccessRateWithCI(
    successes: number,
    total: number,
    confidenceLevel: number = 0.95,
  ): {
    rate: number;
    lowerBound: number;
    upperBound: number;
  } {
    if (total === 0) {
      return { rate: 0, lowerBound: 0, upperBound: 0 };
    }

    const p = successes / total;
    const z = confidenceLevel === 0.95 ? 1.96 : 2.576; // Z-score for 95% and 99%
    const marginOfError = z * Math.sqrt((p * (1 - p)) / total);

    return {
      rate: p * 100,
      lowerBound: Math.max(0, (p - marginOfError) * 100),
      upperBound: Math.min(100, (p + marginOfError) * 100),
    };
  }
}
