import { FEATURE_NAMES } from '../interfaces/feature-set.interface';

export interface NormalizationStats {
  min: number[];
  max: number[];
  mean: number[];
  std: number[];
}

/**
 * Min-max normalization: scales each feature to [0, 1] range.
 * Falls back to mean-std z-score normalization when min==max.
 */
export class FeatureNormalizer {
  private stats: NormalizationStats | null = null;
  private readonly featureCount = FEATURE_NAMES.length;

  fit(data: number[][]): void {
    if (data.length === 0) throw new Error('Cannot fit normalizer on empty data');

    const n = data[0].length;
    const min = new Array(n).fill(Infinity);
    const max = new Array(n).fill(-Infinity);
    const sums = new Array(n).fill(0);

    for (const row of data) {
      for (let i = 0; i < n; i++) {
        if (row[i] < min[i]) min[i] = row[i];
        if (row[i] > max[i]) max[i] = row[i];
        sums[i] += row[i];
      }
    }

    const mean = sums.map((s) => s / data.length);

    const varSums = new Array(n).fill(0);
    for (const row of data) {
      for (let i = 0; i < n; i++) {
        varSums[i] += Math.pow(row[i] - mean[i], 2);
      }
    }
    const std = varSums.map((v) => Math.sqrt(v / data.length) || 1);

    this.stats = { min, max, mean, std };
  }

  transform(vector: number[]): number[] {
    if (!this.stats) return vector.slice();
    const { min, max } = this.stats;
    return vector.map((v, i) => {
      const range = max[i] - min[i];
      if (range === 0) return 0.5; // Feature has no variance
      return Math.max(0, Math.min(1, (v - min[i]) / range));
    });
  }

  fitTransform(data: number[][]): number[][] {
    this.fit(data);
    return data.map((row) => this.transform(row));
  }

  serialize(): NormalizationStats | null {
    return this.stats;
  }

  deserialize(stats: NormalizationStats): void {
    this.stats = stats;
  }

  isFitted(): boolean {
    return this.stats !== null;
  }

  /**
   * Clips a raw feature vector to known valid ranges before normalization.
   * Prevents outlier signals from producing extreme feature values.
   */
  static clip(vector: number[]): number[] {
    return vector.map((v, i) => {
      // Features 8 (marketTrend) and 6 (streakScore) span [-1, 1]; others are [0, 1] or [0, N]
      const isSignedFeature = i === 6 || i === 8;
      if (isSignedFeature) return Math.max(-1, Math.min(1, v));
      return Math.max(0, v);
    });
  }
}
