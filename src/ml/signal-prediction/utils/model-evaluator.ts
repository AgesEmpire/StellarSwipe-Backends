import { ModelEvalResult } from '../interfaces/ml-model.interface';

export interface ThresholdMetrics {
  threshold: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export class ModelEvaluator {
  /**
   * Evaluates a binary classifier across a range of thresholds
   * and returns metrics at the optimal F1 threshold.
   */
  static evaluate(
    probabilities: number[],
    labels: number[],
    threshold = 0.5,
  ): ModelEvalResult {
    const { tp, fp, fn, tn } = ModelEvaluator.confusionMatrix(probabilities, labels, threshold);

    const accuracy = (tp + tn) / (tp + fp + fn + tn) || 0;
    const precision = tp / (tp + fp) || 0;
    const recall = tp / (tp + fn) || 0;
    const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const auc = ModelEvaluator.calculateAUC(probabilities, labels);

    return {
      accuracy,
      precision,
      recall,
      f1Score,
      auc,
      confusionMatrix: [[tp, fp], [fn, tn]],
    };
  }

  static findOptimalThreshold(probabilities: number[], labels: number[]): ThresholdMetrics {
    const thresholds = Array.from({ length: 19 }, (_, i) => 0.05 * (i + 1));
    let best: ThresholdMetrics | null = null;

    for (const threshold of thresholds) {
      const { tp, fp, fn, tn } = ModelEvaluator.confusionMatrix(probabilities, labels, threshold);
      const precision = tp / (tp + fp) || 0;
      const recall = tp / (tp + fn) || 0;
      const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
      const accuracy = (tp + tn) / (tp + fp + fn + tn) || 0;

      const candidate: ThresholdMetrics = { threshold, accuracy, precision, recall, f1Score, tp, fp, fn, tn };
      if (!best || candidate.f1Score > best.f1Score) best = candidate;
    }

    return best!;
  }

  private static confusionMatrix(
    probabilities: number[],
    labels: number[],
    threshold: number,
  ): { tp: number; fp: number; fn: number; tn: number } {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (let i = 0; i < probabilities.length; i++) {
      const predicted = probabilities[i] >= threshold ? 1 : 0;
      const actual = labels[i];
      if (predicted === 1 && actual === 1) tp++;
      else if (predicted === 1 && actual === 0) fp++;
      else if (predicted === 0 && actual === 1) fn++;
      else tn++;
    }
    return { tp, fp, fn, tn };
  }

  /**
   * Trapezoid-rule AUC-ROC.
   */
  static calculateAUC(probabilities: number[], labels: number[]): number {
    const paired = probabilities
      .map((p, i) => ({ p, l: labels[i] }))
      .sort((a, b) => b.p - a.p);

    let auc = 0;
    let tp = 0;
    let fp = 0;
    const totalPos = labels.filter((l) => l === 1).length;
    const totalNeg = labels.length - totalPos;

    if (totalPos === 0 || totalNeg === 0) return 0.5;

    let prevTp = 0;
    let prevFp = 0;

    for (const { l } of paired) {
      if (l === 1) tp++;
      else fp++;
      auc += ((tp + prevTp) / 2) * (fp - prevFp);
      prevTp = tp;
      prevFp = fp;
    }

    return auc / (totalPos * totalNeg);
  }

  /**
   * Mean Absolute Error for regression (PnL prediction).
   */
  static calculateMAE(predictions: number[], actuals: number[]): number {
    if (predictions.length === 0) return 0;
    const sum = predictions.reduce((acc, p, i) => acc + Math.abs(p - actuals[i]), 0);
    return sum / predictions.length;
  }

  /**
   * Mean Squared Error.
   */
  static calculateMSE(predictions: number[], actuals: number[]): number {
    if (predictions.length === 0) return 0;
    const sum = predictions.reduce((acc, p, i) => acc + Math.pow(p - actuals[i], 2), 0);
    return sum / predictions.length;
  }

  /**
   * Calibration score: how well probabilities match actual success rates.
   * Returns a value in [0, 1] where 1 = perfectly calibrated.
   */
  static calibrationScore(probabilities: number[], labels: number[], bins = 10): number {
    const binSize = 1 / bins;
    let totalWeight = 0;
    let weightedError = 0;

    for (let b = 0; b < bins; b++) {
      const lo = b * binSize;
      const hi = lo + binSize;
      const inBin = probabilities
        .map((p, i) => ({ p, l: labels[i] }))
        .filter(({ p }) => p >= lo && p < hi);

      if (inBin.length === 0) continue;
      const meanProb = inBin.reduce((s, { p }) => s + p, 0) / inBin.length;
      const actualRate = inBin.reduce((s, { l }) => s + l, 0) / inBin.length;
      weightedError += inBin.length * Math.abs(meanProb - actualRate);
      totalWeight += inBin.length;
    }

    return totalWeight > 0 ? 1 - weightedError / totalWeight : 0;
  }
}
