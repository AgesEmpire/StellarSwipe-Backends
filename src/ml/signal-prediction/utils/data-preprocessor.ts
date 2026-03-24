import { TrainingData } from '../entities/training-data.entity';
import { FeatureNormalizer } from './feature-normalizer';

export interface ProcessedDataset {
  features: number[][];
  labels: number[];
  pnlLabels: number[];
  normalizer: FeatureNormalizer;
  trainSize: number;
  valSize: number;
}

export interface TrainValSplit {
  trainFeatures: number[][];
  trainLabels: number[];
  trainPnlLabels: number[];
  valFeatures: number[][];
  valLabels: number[];
  valPnlLabels: number[];
}

export class DataPreprocessor {
  /**
   * Converts raw TrainingData rows into normalized feature matrices,
   * applies stratified train/val split, and returns everything the
   * model trainer needs.
   */
  static process(
    rows: TrainingData[],
    validationSplit = 0.2,
  ): ProcessedDataset {
    // Shuffle deterministically to avoid time-based bias
    const shuffled = DataPreprocessor.shuffle(rows);

    const rawFeatures = shuffled.map((r) => r.featureVector as number[]);
    const labels = shuffled.map((r) => r.successLabel);
    const pnlLabels = shuffled.map((r) => Number(r.pnlLabel));

    const normalizer = new FeatureNormalizer();
    const normalizedFeatures = normalizer.fitTransform(rawFeatures);

    const valSize = Math.max(1, Math.round(shuffled.length * validationSplit));
    const trainSize = shuffled.length - valSize;

    return { features: normalizedFeatures, labels, pnlLabels, normalizer, trainSize, valSize };
  }

  static split(dataset: ProcessedDataset): TrainValSplit {
    const { features, labels, pnlLabels, trainSize } = dataset;
    return {
      trainFeatures: features.slice(0, trainSize),
      trainLabels: labels.slice(0, trainSize),
      trainPnlLabels: pnlLabels.slice(0, trainSize),
      valFeatures: features.slice(trainSize),
      valLabels: labels.slice(trainSize),
      valPnlLabels: pnlLabels.slice(trainSize),
    };
  }

  /**
   * Removes outlier samples where any feature is beyond 3 standard deviations
   * from the column mean (computed on-the-fly).
   */
  static removeOutliers(rows: TrainingData[], zThreshold = 3): TrainingData[] {
    if (rows.length < 10) return rows;

    const vectors = rows.map((r) => r.featureVector as number[]);
    const n = vectors[0].length;
    const means = new Array(n).fill(0);
    const stds = new Array(n).fill(0);

    for (const v of vectors) {
      for (let i = 0; i < n; i++) means[i] += v[i];
    }
    means.forEach((_, i) => (means[i] /= vectors.length));

    for (const v of vectors) {
      for (let i = 0; i < n; i++) stds[i] += Math.pow(v[i] - means[i], 2);
    }
    stds.forEach((_, i) => (stds[i] = Math.sqrt(stds[i] / vectors.length) || 1));

    return rows.filter((r) => {
      const v = r.featureVector as number[];
      return v.every((val, i) => Math.abs((val - means[i]) / stds[i]) <= zThreshold);
    });
  }

  /**
   * Oversamples the minority class to balance the dataset.
   * Used when success/failure label distribution is heavily skewed.
   */
  static balanceClasses(
    features: number[][],
    labels: number[],
    pnlLabels: number[],
  ): { features: number[][]; labels: number[]; pnlLabels: number[] } {
    const posIdx = labels.map((l, i) => (l === 1 ? i : -1)).filter((i) => i >= 0);
    const negIdx = labels.map((l, i) => (l === 0 ? i : -1)).filter((i) => i >= 0);

    if (posIdx.length === 0 || negIdx.length === 0) return { features, labels, pnlLabels };

    const majority = posIdx.length > negIdx.length ? posIdx : negIdx;
    const minority = posIdx.length > negIdx.length ? negIdx : posIdx;

    const oversampleCount = majority.length - minority.length;
    const extra = Array.from({ length: oversampleCount }, () => {
      const srcIdx = minority[Math.floor(Math.random() * minority.length)];
      return srcIdx;
    });

    const allIdx = [...majority, ...minority, ...extra];
    // Deterministic sort to avoid random ordering issues
    allIdx.sort((a, b) => a - b);

    return {
      features: allIdx.map((i) => features[i]),
      labels: allIdx.map((i) => labels[i]),
      pnlLabels: allIdx.map((i) => pnlLabels[i]),
    };
  }

  private static shuffle<T>(arr: T[]): T[] {
    const copy = arr.slice();
    // Deterministic Fisher-Yates using a seeded value derived from array length
    let seed = copy.length * 31337;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0xffffffff;
    };
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}
