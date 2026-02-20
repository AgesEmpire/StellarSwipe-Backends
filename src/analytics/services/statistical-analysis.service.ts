import { Injectable } from '@nestjs/common';

@Injectable()
export class StatisticalAnalysisService {
  calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  calculateStandardDeviation(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = this.calculateMean(values);
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor((percentile / 100) * sorted.length);
    return sorted[Math.min(index, sorted.length - 1)];
  }

  calculateCovariance(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 2) return 0;
    const meanX = this.calculateMean(x);
    const meanY = this.calculateMean(y);
    const covariance = x.reduce((sum, xi, i) => {
      return sum + (xi - meanX) * (y[i] - meanY);
    }, 0) / (x.length - 1);
    return covariance;
  }

  calculateCorrelation(x: number[], y: number[]): number {
    const covariance = this.calculateCovariance(x, y);
    const stdX = this.calculateStandardDeviation(x);
    const stdY = this.calculateStandardDeviation(y);
    if (stdX === 0 || stdY === 0) return 0;
    return covariance / (stdX * stdY);
  }
}
