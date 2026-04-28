import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { SignalDecay, DecayStatus } from './entities/signal-decay.entity';
import {
  AnalyzeSignalDecayDto,
  DecayAnalysisResultDto,
  BulkDecayAnalysisDto,
} from './dto/decay-analysis.dto';
import {
  OptimalTimingQueryDto,
  OptimalTimingResultDto,
  SignalLifespanRecommendationDto,
} from './dto/optimal-timing.dto';
import { DecayCurveFitter } from './utils/decay-curve-fitter';
import { TimingOptimizer, SignalDecaySnapshot } from './utils/timing-optimizer';

@Injectable()
export class DecayAnalyzerService {
  private readonly logger = new Logger(DecayAnalyzerService.name);
  private readonly MIN_ACCURACY_THRESHOLD = 0.55;
  private readonly EXPIRY_ACCURACY_THRESHOLD = 0.45;

  constructor(
    @InjectRepository(SignalDecay)
    private readonly decayRepository: Repository<SignalDecay>,
  ) {}

  /**
   * Analyze signal decay from raw performance data and persist the result.
   */
  async analyzeDecay(
    dto: AnalyzeSignalDecayDto,
  ): Promise<DecayAnalysisResultDto> {
    this.logger.log(
      `Analyzing decay for signal ${dto.signalId} (type: ${dto.signalType})`,
    );

    const fitResult = DecayCurveFitter.fitBestCurve(
      dto.performanceData,
      dto.preferredCurveType,
    );
    const initialAccuracy = dto.performanceData[0]?.accuracy ?? 0;
    const currentAccuracy =
      dto.performanceData[dto.performanceData.length - 1]?.accuracy ?? 0;
    const halfLifeHours = DecayCurveFitter.computeHalfLife(
      fitResult.curveType,
      fitResult.parameters,
      initialAccuracy,
    );
    const recommendedExpiryHours = DecayCurveFitter.solveForHours(
      fitResult.curveType,
      fitResult.parameters,
      this.EXPIRY_ACCURACY_THRESHOLD,
      initialAccuracy,
    );

    // Build hour-by-hour performance map
    const performanceByHour: Record<string, number> = {};
    for (const point of dto.performanceData) {
      performanceByHour[String(Math.round(point.hoursElapsed))] =
        point.accuracy;
    }

    // Find optimal entry window (hours where accuracy >= threshold)
    const { start: optimalStart, end: optimalEnd } = this.findOptimalWindow(
      fitResult.curveType,
      fitResult.parameters,
      initialAccuracy,
      recommendedExpiryHours,
    );

    const status = this.deriveStatus(
      currentAccuracy,
      recommendedExpiryHours,
      halfLifeHours,
    );
    const analyzedAt = new Date();
    const validUntil = new Date(analyzedAt.getTime() + 24 * 60 * 60 * 1000); // re-analyze after 24h

    const entity = this.decayRepository.create({
      signalId: dto.signalId,
      signalType: dto.signalType,
      decayCurveType: fitResult.curveType,
      status,
      initialAccuracy,
      currentAccuracy,
      decayRate: fitResult.parameters.b ?? 0,
      halfLifeHours,
      optimalEntryWindowStart: optimalStart,
      optimalEntryWindowEnd: optimalEnd,
      recommendedExpiryHours,
      sampleCount: dto.performanceData.length,
      rSquared: fitResult.rSquared,
      curveParameters: fitResult.parameters,
      performanceByHour,
      volatilityAdjusted: dto.volatilityAdjusted ?? false,
      marketRegime: dto.marketRegime ?? null,
      analyzedAt,
      validUntil,
    });

    await this.decayRepository.save(entity);
    this.logger.log(
      `Decay analysis saved for signal ${dto.signalId}: halfLife=${halfLifeHours.toFixed(2)}h, R²=${fitResult.rSquared?.toFixed(4)}`,
    );

    return this.toResultDto(entity);
  }

  /**
   * Retrieve the latest decay analysis for a given signal.
   */
  async getDecayAnalysis(signalId: string): Promise<DecayAnalysisResultDto> {
    const entity = await this.decayRepository.findOne({
      where: { signalId },
      order: { analyzedAt: 'DESC' },
    });

    if (!entity) {
      throw new NotFoundException(
        `No decay analysis found for signal: ${signalId}`,
      );
    }

    return this.toResultDto(entity);
  }

  /**
   * Run decay analysis for multiple signals and return all results.
   */
  async getBulkDecayAnalysis(
    dto: BulkDecayAnalysisDto,
  ): Promise<DecayAnalysisResultDto[]> {
    const where: Partial<SignalDecay> = {};
    if (dto.signalType) where.signalType = dto.signalType;

    const entities = await this.decayRepository
      .createQueryBuilder('decay')
      .where('decay.signal_id IN (:...signalIds)', { signalIds: dto.signalIds })
      .andWhere(dto.analyzedAfter ? 'decay.analyzed_at > :after' : '1=1', {
        after: dto.analyzedAfter,
      })
      .orderBy('decay.analyzed_at', 'DESC')
      .distinctOn(['decay.signal_id'])
      .getMany();

    return entities.map((e) => this.toResultDto(e));
  }

  /**
   * Compute optimal timing windows for a signal type.
   */
  async getOptimalTiming(
    dto: OptimalTimingQueryDto,
  ): Promise<OptimalTimingResultDto> {
    this.logger.log(
      `Computing optimal timing for signal type: ${dto.signalType}`,
    );

    const queryBuilder = this.decayRepository
      .createQueryBuilder('decay')
      .where('decay.signal_type = :signalType', { signalType: dto.signalType })
      .andWhere('decay.sample_count > 0');

    if (dto.marketRegime) {
      queryBuilder.andWhere('decay.market_regime = :regime', {
        regime: dto.marketRegime,
      });
    }

    const entities = await queryBuilder
      .orderBy('decay.analyzed_at', 'DESC')
      .limit(500)
      .getMany();

    if (entities.length === 0) {
      throw new NotFoundException(
        `No decay data found for signal type: ${dto.signalType}`,
      );
    }

    const snapshots: SignalDecaySnapshot[] = entities
      .filter((e) => e.curveParameters && e.performanceByHour)
      .map((e) => ({
        signalType: e.signalType,
        decayCurveType: e.decayCurveType,
        curveParameters: e.curveParameters!,
        halfLifeHours: Number(e.halfLifeHours),
        optimalEntryWindowStart: e.optimalEntryWindowStart
          ? Number(e.optimalEntryWindowStart)
          : null,
        optimalEntryWindowEnd: e.optimalEntryWindowEnd
          ? Number(e.optimalEntryWindowEnd)
          : null,
        recommendedExpiryHours: Number(e.recommendedExpiryHours),
        performanceByHour: e.performanceByHour!,
        sampleCount: e.sampleCount,
      }));

    return TimingOptimizer.computeOptimalTiming(
      dto.signalType,
      snapshots,
      dto.minAccuracyThreshold ?? this.MIN_ACCURACY_THRESHOLD,
    );
  }

  /**
   * Assess whether a live signal should be expired based on its age and decay model.
   */
  async assessSignalLifespan(
    signalId: string,
    signalCreatedAt: Date,
  ): Promise<SignalLifespanRecommendationDto> {
    const entity = await this.decayRepository.findOne({
      where: { signalId },
      order: { analyzedAt: 'DESC' },
    });

    if (!entity) {
      throw new NotFoundException(
        `No decay analysis found for signal: ${signalId}`,
      );
    }

    return TimingOptimizer.assessSignalLifespan(
      signalId,
      entity.signalType,
      signalCreatedAt,
      entity.decayCurveType,
      entity.curveParameters!,
      Number(entity.recommendedExpiryHours),
      this.MIN_ACCURACY_THRESHOLD,
    );
  }

  /**
   * Refresh status of all active/degraded decay records and mark expired ones.
   * Called by the scheduled job.
   */
  async refreshDecayStatuses(): Promise<{ updated: number }> {
    const activeEntities = await this.decayRepository.find({
      where: [{ status: DecayStatus.ACTIVE }, { status: DecayStatus.DEGRADED }],
    });

    let updated = 0;
    const now = new Date();

    for (const entity of activeEntities) {
      const ageHours =
        (now.getTime() - entity.analyzedAt.getTime()) / (1000 * 60 * 60);
      const projectedAccuracy = entity.curveParameters
        ? DecayCurveFitter.predict(
            ageHours,
            entity.decayCurveType,
            entity.curveParameters,
          )
        : Number(entity.currentAccuracy);

      const newStatus = this.deriveStatus(
        projectedAccuracy,
        Number(entity.recommendedExpiryHours),
        Number(entity.halfLifeHours),
      );

      if (newStatus !== entity.status) {
        entity.status = newStatus;
        entity.currentAccuracy = projectedAccuracy;
        await this.decayRepository.save(entity);
        updated++;
      }
    }

    this.logger.log(`Decay status refresh complete. Updated: ${updated}`);
    return { updated };
  }

  // -------------------------
  // Private helpers
  // -------------------------

  private findOptimalWindow(
    curveType: any,
    parameters: Record<string, number>,
    initialAccuracy: number,
    maxHours: number,
  ): { start: number | null; end: number | null } {
    if (initialAccuracy < this.MIN_ACCURACY_THRESHOLD) {
      return { start: null, end: null };
    }

    const start = 0;
    const end = DecayCurveFitter.solveForHours(
      curveType,
      parameters,
      this.MIN_ACCURACY_THRESHOLD,
      initialAccuracy,
      maxHours,
    );

    return { start, end: Math.round(end * 100) / 100 };
  }

  private deriveStatus(
    accuracy: number,
    recommendedExpiryHours: number,
    halfLifeHours: number,
  ): DecayStatus {
    if (accuracy < this.EXPIRY_ACCURACY_THRESHOLD) {
      return DecayStatus.EXPIRED;
    }
    if (accuracy < this.MIN_ACCURACY_THRESHOLD) {
      return DecayStatus.DEGRADED;
    }
    return DecayStatus.ACTIVE;
  }

  private toResultDto(entity: SignalDecay): DecayAnalysisResultDto {
    const accuracyPct = (v: number) => Math.round(v * 10000) / 10000;

    return {
      signalId: entity.signalId,
      signalType: entity.signalType,
      decayCurveType: entity.decayCurveType,
      status: entity.status,
      initialAccuracy: accuracyPct(Number(entity.initialAccuracy)),
      currentAccuracy: accuracyPct(Number(entity.currentAccuracy)),
      decayRate: Number(entity.decayRate),
      halfLifeHours: Number(entity.halfLifeHours),
      optimalEntryWindowStart: entity.optimalEntryWindowStart
        ? Number(entity.optimalEntryWindowStart)
        : null,
      optimalEntryWindowEnd: entity.optimalEntryWindowEnd
        ? Number(entity.optimalEntryWindowEnd)
        : null,
      recommendedExpiryHours: Number(entity.recommendedExpiryHours),
      rSquared: entity.rSquared ? Number(entity.rSquared) : null,
      curveParameters: entity.curveParameters ?? {},
      performanceByHour: entity.performanceByHour ?? {},
      analyzedAt: entity.analyzedAt,
      validUntil: entity.validUntil,
      summary: this.buildSummary(entity),
    };
  }

  private buildSummary(entity: SignalDecay): string {
    return (
      `Signal ${entity.signalId} follows a ${entity.decayCurveType} decay curve ` +
      `(R²=${Number(entity.rSquared ?? 0).toFixed(3)}). ` +
      `Half-life: ${Number(entity.halfLifeHours).toFixed(1)}h. ` +
      `Recommended expiry: ${Number(entity.recommendedExpiryHours).toFixed(1)}h. ` +
      `Status: ${entity.status}.`
    );
  }
}
