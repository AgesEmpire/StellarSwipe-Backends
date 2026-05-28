import { Inject, Injectable, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import {
  DriftDetectionInput,
  DriftDetectorService,
  DriftFindingRecord,
} from '../drift-detector.service';

export const DRIFT_FEED_PROVIDER = Symbol('DRIFT_FEED_PROVIDER');

export interface DriftFeedSnapshotProvider {
  getDriftSnapshots(): Promise<DriftDetectionInput[]>;
}

@Injectable()
export class DetectDataDriftJob {
  constructor(
    private readonly driftDetector: DriftDetectorService,
    @Optional()
    @Inject(DRIFT_FEED_PROVIDER)
    private readonly feedProvider?: DriftFeedSnapshotProvider,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<DriftFindingRecord[]> {
    if (!this.feedProvider) return [];

    const snapshots = await this.feedProvider.getDriftSnapshots();
    const findings = await Promise.all(
      snapshots.map((snapshot) => this.driftDetector.detectFeedDrift(snapshot)),
    );

    return findings.flat();
  }
}
