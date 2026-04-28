import { DecayCurveType } from '../entities/signal-decay.entity';
import { PerformanceDataPointDto } from '../dto/decay-analysis.dto';

export interface CurveFitResult {
  curveType: DecayCurveType;
  parameters: Record<string, number>;
  rSquared: number;
  predictedValues: number[];
}

export interface FitCandidate {
  curveType: DecayCurveType;
  result: CurveFitResult;
}

export class DecayCurveFitter {
  /**
   * Fits all supported curve types and returns the best fit.
   */
  static fitBestCurve(
    dataPoints: PerformanceDataPointDto[],
    preferredType?: DecayCurveType,
  ): CurveFitResult {
    if (dataPoints.length < 2) {
      throw new Error('At least 2 data points are required for curve fitting.');
    }

    const candidates: FitCandidate[] = [
      {
        curveType: DecayCurveType.EXPONENTIAL,
        result: this.fitExponential(dataPoints),
      },
      { curveType: DecayCurveType.LINEAR, result: this.fitLinear(dataPoints) },
      {
        curveType: DecayCurveType.LOGARITHMIC,
        result: this.fitLogarithmic(dataPoints),
      },
      { curveType: DecayCurveType.POWER, result: this.fitPower(dataPoints) },
    ].filter((c) => !isNaN(c.result.rSquared) && isFinite(c.result.rSquared));

    if (candidates.length === 0) {
      throw new Error(
        'No valid curve fit could be computed from the provided data.',
      );
    }

    if (preferredType) {
      const preferred = candidates.find((c) => c.curveType === preferredType);
      if (preferred && preferred.result.rSquared >= 0.5) {
        return preferred.result;
      }
    }

    return candidates.reduce((best, current) =>
      current.result.rSquared > best.result.rSquared ? current : best,
    ).result;
  }

  /**
   * Fits an exponential decay curve: y = a * e^(-b * x)
   */
  static fitExponential(dataPoints: PerformanceDataPointDto[]): CurveFitResult {
    const validPoints = dataPoints.filter((p) => p.accuracy > 0);
    if (validPoints.length < 2) {
      return this.fallbackLinear(dataPoints, DecayCurveType.EXPONENTIAL);
    }

    // Linearize: ln(y) = ln(a) - b*x
    const n = validPoints.length;
    const x = validPoints.map((p) => p.hoursElapsed);
    const lnY = validPoints.map((p) => Math.log(p.accuracy));

    const { slope, intercept } = this.linearRegression(x, lnY);
    const a = Math.exp(intercept);
    const b = -slope;

    const predicted = dataPoints.map((p) => a * Math.exp(-b * p.hoursElapsed));
    const rSquared = this.computeRSquared(
      dataPoints.map((p) => p.accuracy),
      predicted,
    );

    return {
      curveType: DecayCurveType.EXPONENTIAL,
      parameters: { a, b },
      rSquared,
      predictedValues: predicted,
    };
  }

  /**
   * Fits a linear decay curve: y = a + b * x
   */
  static fitLinear(dataPoints: PerformanceDataPointDto[]): CurveFitResult {
    const x = dataPoints.map((p) => p.hoursElapsed);
    const y = dataPoints.map((p) => p.accuracy);

    const { slope, intercept } = this.linearRegression(x, y);
    const predicted = dataPoints.map((p) => intercept + slope * p.hoursElapsed);
    const rSquared = this.computeRSquared(y, predicted);

    return {
      curveType: DecayCurveType.LINEAR,
      parameters: { a: intercept, b: slope },
      rSquared,
      predictedValues: predicted,
    };
  }

  /**
   * Fits a logarithmic decay curve: y = a + b * ln(x)
   * Note: x must be > 0.
   */
  static fitLogarithmic(dataPoints: PerformanceDataPointDto[]): CurveFitResult {
    const validPoints = dataPoints.filter((p) => p.hoursElapsed > 0);
    if (validPoints.length < 2) {
      return this.fallbackLinear(dataPoints, DecayCurveType.LOGARITHMIC);
    }

    const lnX = validPoints.map((p) => Math.log(p.hoursElapsed));
    const y = validPoints.map((p) => p.accuracy);

    const { slope, intercept } = this.linearRegression(lnX, y);
    const predicted = dataPoints.map((p) =>
      p.hoursElapsed > 0
        ? intercept + slope * Math.log(p.hoursElapsed)
        : intercept,
    );
    const rSquared = this.computeRSquared(
      dataPoints.map((p) => p.accuracy),
      predicted,
    );

    return {
      curveType: DecayCurveType.LOGARITHMIC,
      parameters: { a: intercept, b: slope },
      rSquared,
      predictedValues: predicted,
    };
  }

  /**
   * Fits a power decay curve: y = a * x^b
   * Both x and y must be > 0.
   */
  static fitPower(dataPoints: PerformanceDataPointDto[]): CurveFitResult {
    const validPoints = dataPoints.filter(
      (p) => p.hoursElapsed > 0 && p.accuracy > 0,
    );
    if (validPoints.length < 2) {
      return this.fallbackLinear(dataPoints, DecayCurveType.POWER);
    }

    const lnX = validPoints.map((p) => Math.log(p.hoursElapsed));
    const lnY = validPoints.map((p) => Math.log(p.accuracy));

    const { slope, intercept } = this.linearRegression(lnX, lnY);
    const a = Math.exp(intercept);
    const b = slope;

    const predicted = dataPoints.map((p) =>
      p.hoursElapsed > 0 ? a * Math.pow(p.hoursElapsed, b) : a,
    );
    const rSquared = this.computeRSquared(
      dataPoints.map((p) => p.accuracy),
      predicted,
    );

    return {
      curveType: DecayCurveType.POWER,
      parameters: { a, b },
      rSquared,
      predictedValues: predicted,
    };
  }

  /**
   * Predict accuracy at a given hour using curve parameters.
   */
  static predict(
    hoursElapsed: number,
    curveType: DecayCurveType,
    parameters: Record<string, number>,
  ): number {
    const { a, b } = parameters;
    let value: number;

    switch (curveType) {
      case DecayCurveType.EXPONENTIAL:
        value = a * Math.exp(-b * hoursElapsed);
        break;
      case DecayCurveType.LINEAR:
        value = a + b * hoursElapsed;
        break;
      case DecayCurveType.LOGARITHMIC:
        value = hoursElapsed > 0 ? a + b * Math.log(hoursElapsed) : a;
        break;
      case DecayCurveType.POWER:
        value = hoursElapsed > 0 ? a * Math.pow(hoursElapsed, b) : a;
        break;
      default:
        value = a * Math.exp(-b * hoursElapsed);
    }

    return Math.max(0, Math.min(1, value));
  }

  /**
   * Compute the half-life (hours until accuracy drops to 50% of initial).
   */
  static computeHalfLife(
    curveType: DecayCurveType,
    parameters: Record<string, number>,
    initialAccuracy: number,
  ): number {
    const target = initialAccuracy * 0.5;
    return this.solveForHours(curveType, parameters, target, initialAccuracy);
  }

  /**
   * Solve numerically for the hour at which the predicted accuracy reaches the target.
   */
  static solveForHours(
    curveType: DecayCurveType,
    parameters: Record<string, number>,
    targetAccuracy: number,
    initialAccuracy: number,
    maxHours = 8760,
  ): number {
    if (curveType === DecayCurveType.EXPONENTIAL && parameters.b > 0) {
      const { a, b } = parameters;
      if (a <= 0) return maxHours;
      return Math.log(a / targetAccuracy) / b;
    }

    // Binary search for other curve types
    let lo = 0;
    let hi = maxHours;
    for (let i = 0; i < 64; i++) {
      const mid = (lo + hi) / 2;
      const pred = this.predict(mid, curveType, parameters);
      if (pred > targetAccuracy) {
        lo = mid;
      } else {
        hi = mid;
      }
      if (hi - lo < 0.01) break;
    }
    return (lo + hi) / 2;
  }

  // -------------------------
  // Private helpers
  // -------------------------

  private static linearRegression(
    x: number[],
    y: number[],
  ): { slope: number; intercept: number } {
    const n = x.length;
    const sumX = x.reduce((s, v) => s + v, 0);
    const sumY = y.reduce((s, v) => s + v, 0);
    const sumXY = x.reduce((s, v, i) => s + v * y[i], 0);
    const sumX2 = x.reduce((s, v) => s + v * v, 0);
    const denom = n * sumX2 - sumX * sumX;

    if (denom === 0) {
      return { slope: 0, intercept: sumY / n };
    }

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept };
  }

  private static computeRSquared(
    actual: number[],
    predicted: number[],
  ): number {
    const mean = actual.reduce((s, v) => s + v, 0) / actual.length;
    const ssTot = actual.reduce((s, v) => s + (v - mean) ** 2, 0);
    const ssRes = actual.reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0);
    if (ssTot === 0) return 1;
    return 1 - ssRes / ssTot;
  }

  private static fallbackLinear(
    dataPoints: PerformanceDataPointDto[],
    requestedType: DecayCurveType,
  ): CurveFitResult {
    const result = this.fitLinear(dataPoints);
    return { ...result, curveType: requestedType };
  }
}
