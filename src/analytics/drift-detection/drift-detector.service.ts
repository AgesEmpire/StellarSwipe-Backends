import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DriftFinding } from './entities/drift-finding.entity';
import { analyzeDrift, DriftScore } from './utils/distribution-analyzer';

export interface FeedSample {
  /** Identifier for the metric / feed being monitored (e.g. 'trade_volume', 'price_xlm_usd') */
  feedKey: string;
  /** Numeric observations from the current window */
  currentValues: number[];
  /** Numeric observations from the baseline window */
  baselineValues: number[];
}

export interface DriftResult {
  feedKey: string;
  score: DriftScore;
  /** Whether the drift exceeds the configured alert threshold */
  isDrift: boolean;
  /** Severity level derived from PSI */
  severity: 'stable' | 'minor' | 'significant';
  detectedAt: Date;
}

/** PSI thresholds — industry standard for distribution monitoring */
const PSI_MINOR_THRESHOLD = 0.1;
const PSI_SIGNIFICANT_THRESHOLD = 0.2;

@Injectable()
export class DriftDetectorService {
  private readonly logger = new Logger(DriftDetectorService.name);

  constructor(
    @InjectRepository(DriftFinding)
    private readonly driftFindingRepo: Repository<DriftFinding>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Analyse a set of feed samples and persist any detected drift findings.
   * Emits an 'analytics.drift.detected' event for each feed that exceeds the threshold.
   */
  async detectDrift(samples: FeedSample[]): Promise<DriftResult[]> {
    const results: DriftResult[] = [];

    for (const sample of samples) {
      const result = await this.analyseSample(sample);
      results.push(result);

      if (result.isDrift) {
        await this.persistFinding(result);
        this.publishAlert(result);
      }
    }

    this.logger.log(
      `Drift detection completed: ${results.length} feeds analysed, ` +
        `${results.filter((r) => r.isDrift).length} anomalies found`,
    );

    return results;
  }

  /**
   * Retrieve stored drift findings for review, optionally filtered by feed key
   * and limited to findings newer than a given date.
   */
  async getFindings(options?: {
    feedKey?: string;
    since?: Date;
    limit?: number;
  }): Promise<DriftFinding[]> {
    const where: Record<string, unknown> = {};

    if (options?.feedKey) {
      where['feedKey'] = options.feedKey;
    }
    if (options?.since) {
      where['detectedAt'] = MoreThanOrEqual(options.since);
    }

    return this.driftFindingRepo.find({
      where,
      order: { detectedAt: 'DESC' },
      take: options?.limit ?? 100,
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private analyseSample(sample: FeedSample): DriftResult {
    const score = analyzeDrift(sample.baselineValues, sample.currentValues);
    const severity = this.classifySeverity(score.psi);
    const isDrift = score.psi >= PSI_MINOR_THRESHOLD;
    const detectedAt = new Date();

    this.logger.debug(
      `Feed "${sample.feedKey}" — PSI: ${score.psi.toFixed(4)}, ` +
        `JS: ${score.jsDivergence.toFixed(4)}, severity: ${severity}`,
    );

    return { feedKey: sample.feedKey, score, isDrift, severity, detectedAt };
  }

  private classifySeverity(psi: number): 'stable' | 'minor' | 'significant' {
    if (psi >= PSI_SIGNIFICANT_THRESHOLD) return 'significant';
    if (psi >= PSI_MINOR_THRESHOLD) return 'minor';
    return 'stable';
  }

  private async persistFinding(result: DriftResult): Promise<void> {
    try {
      const finding = this.driftFindingRepo.create({
        feedKey: result.feedKey,
        severity: result.severity,
        psi: result.score.psi,
        jsDivergence: result.score.jsDivergence,
        currentMean: result.score.currentMean,
        baselineMean: result.score.baselineMean,
        currentStdDev: result.score.currentStdDev,
        baselineStdDev: result.score.baselineStdDev,
        meanShiftRatio: result.score.meanShiftRatio,
        detectedAt: result.detectedAt,
      });
      await this.driftFindingRepo.save(finding);
    } catch (error) {
      this.logger.error(
        `Failed to persist drift finding for feed "${result.feedKey}"`,
        (error as Error).stack,
      );
    }
  }

  private publishAlert(result: DriftResult): void {
    try {
      this.eventEmitter.emit('analytics.drift.detected', {
        feedKey: result.feedKey,
        severity: result.severity,
        psi: result.score.psi,
        jsDivergence: result.score.jsDivergence,
        meanShiftRatio: result.score.meanShiftRatio,
        detectedAt: result.detectedAt,
      });

      this.logger.warn(
        `Drift alert published for feed "${result.feedKey}" — ` +
          `severity: ${result.severity}, PSI: ${result.score.psi.toFixed(4)}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish drift alert for feed "${result.feedKey}"`,
        (error as Error).stack,
      );
    }
  }
}
