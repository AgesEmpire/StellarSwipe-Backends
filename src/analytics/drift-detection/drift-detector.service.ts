import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  DistributionComparison,
  compareDistributions,
} from './utils/distribution-analyzer';

export const DRIFT_ALERT_PUBLISHER = Symbol('DRIFT_ALERT_PUBLISHER');
export const DRIFT_FINDING_STORE = Symbol('DRIFT_FINDING_STORE');

export type DriftSeverity = 'warning' | 'critical';

export interface DriftDetectionInput {
  feedName: string;
  baseline: Record<string, number[]>;
  current: Record<string, number[]>;
  threshold?: number;
}

export interface DriftFindingRecord {
  feedName: string;
  metric: string;
  severity: DriftSeverity;
  score: number;
  threshold: number;
  baselineMean: number;
  currentMean: number;
  detectedAt: Date;
  comparison: DistributionComparison;
}

export interface DriftAlertPublisher {
  publishDriftAlert(finding: DriftFindingRecord): Promise<void> | void;
}

export interface DriftFindingStore {
  saveDriftFinding(finding: DriftFindingRecord): Promise<void> | void;
}

@Injectable()
export class DriftDetectorService {
  constructor(
    @Optional()
    @Inject(DRIFT_FINDING_STORE)
    private readonly findingStore?: DriftFindingStore,
    @Optional()
    @Inject(DRIFT_ALERT_PUBLISHER)
    private readonly alertPublisher?: DriftAlertPublisher,
  ) {}

  async detectFeedDrift(
    input: DriftDetectionInput,
  ): Promise<DriftFindingRecord[]> {
    const findings: DriftFindingRecord[] = [];

    for (const metric of Object.keys(input.current)) {
      const baselineValues = input.baseline[metric] ?? [];
      const currentValues = input.current[metric] ?? [];

      if (baselineValues.length === 0 || currentValues.length === 0) {
        continue;
      }

      const comparison = compareDistributions(
        metric,
        baselineValues,
        currentValues,
        input.threshold,
      );

      if (!comparison.drifted) continue;

      const finding: DriftFindingRecord = {
        feedName: input.feedName,
        metric,
        severity: this.getSeverity(comparison),
        score: comparison.driftScore,
        threshold: comparison.threshold,
        baselineMean: comparison.baseline.mean,
        currentMean: comparison.current.mean,
        detectedAt: new Date(),
        comparison,
      };

      await this.findingStore?.saveDriftFinding(finding);
      await this.alertPublisher?.publishDriftAlert(finding);
      findings.push(finding);
    }

    return findings;
  }

  private getSeverity(comparison: DistributionComparison): DriftSeverity {
    return comparison.driftScore >= comparison.threshold * 2
      ? 'critical'
      : 'warning';
  }
}
