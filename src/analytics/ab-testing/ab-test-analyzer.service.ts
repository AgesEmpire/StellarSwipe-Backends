import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExperimentResult } from './entities/experiment-result.entity';
import { VariantPerformance } from './entities/variant-performance.entity';
import { ExperimentAnalysisDto } from './dto/experiment-analysis.dto';
import { RecommendationDto } from './dto/recommendation.dto';
import { StatisticalTestResult, VariantMetrics } from './interfaces/statistical-test.interface';
import { chiSquareTest } from './analyzers/chi-square.analyzer';
import { tTest } from './analyzers/t-test.analyzer';
import { bayesianTest } from './analyzers/bayesian.analyzer';
import { confidenceInterval } from './utils/confidence-interval';
import { findWinner, relativeUplift } from './utils/significance-calculator';

@Injectable()
export class AbTestAnalyzerService {
  constructor(
    @InjectRepository(ExperimentResult)
    private readonly experimentRepo: Repository<ExperimentResult>,
    @InjectRepository(VariantPerformance)
    private readonly variantRepo: Repository<VariantPerformance>,
  ) {}

  async analyze(dto: ExperimentAnalysisDto): Promise<{
    experimentId: string;
    tests: StatisticalTestResult[];
    recommendation: RecommendationDto;
  }> {
    const cl = dto.confidenceLevel ?? 0.95;
    const variants: VariantMetrics[] = dto.variants.map((v) => ({
      ...v,
      conversionRate: v.conversions / v.impressions,
    }));

    const [control, ...challengers] = variants;
    const tests: StatisticalTestResult[] = [];

    for (const challenger of challengers) {
      // Chi-square (conversion rates)
      const chi = chiSquareTest(
        control.conversions, control.impressions,
        challenger.conversions, challenger.impressions,
        cl,
      );

      // t-test (if mean/stdDev provided)
      const hasContinuous =
        control.mean != null && control.stdDev != null &&
        challenger.mean != null && challenger.stdDev != null;

      const tt = hasContinuous
        ? tTest(
            control.mean!, control.stdDev!, control.impressions,
            challenger.mean!, challenger.stdDev!, challenger.impressions,
            cl,
          )
        : null;

      // Bayesian
      const bayes = bayesianTest(
        control.conversions, control.impressions,
        challenger.conversions, challenger.impressions,
        cl,
      );

      const ci = confidenceInterval(challenger.conversions, challenger.impressions, cl);
      const uplift = relativeUplift(control.conversionRate, challenger.conversionRate);
      const isSignificant = chi.isSignificant && bayes.isSignificant;

      tests.push(
        {
          testType: 'chi-square',
          statistic: chi.statistic,
          pValue: chi.pValue,
          isSignificant: chi.isSignificant,
          confidenceLevel: cl,
          confidenceInterval: ci,
          effectSize: chi.effectSize,
          recommendation: this.recommend(chi.isSignificant, uplift),
          reason: `Chi-square statistic: ${chi.statistic.toFixed(4)}, p=${chi.pValue.toFixed(4)}`,
        },
        ...(tt
          ? [{
              testType: 't-test' as const,
              statistic: tt.statistic,
              pValue: tt.pValue,
              isSignificant: tt.isSignificant,
              confidenceLevel: cl,
              confidenceInterval: ci,
              effectSize: tt.effectSize,
              recommendation: this.recommend(tt.isSignificant, uplift),
              reason: `t-statistic: ${tt.statistic.toFixed(4)}, p=${tt.pValue.toFixed(4)}`,
            }]
          : []),
        {
          testType: 'bayesian',
          statistic: bayes.statistic,
          pValue: bayes.pValue,
          isSignificant: bayes.isSignificant,
          confidenceLevel: cl,
          confidenceInterval: ci,
          effectSize: bayes.effectSize,
          recommendation: this.recommend(bayes.isSignificant, uplift),
          reason: `P(variant > control) = ${(bayes.statistic * 100).toFixed(1)}%`,
        },
      );

      // Persist variant performance
      await this.variantRepo.save([
        this.variantRepo.create({ experimentId: dto.experimentId, ...control }),
        this.variantRepo.create({ experimentId: dto.experimentId, ...challenger }),
      ]);

      // Persist experiment result
      const winner = isSignificant ? findWinner(variants) : null;
      await this.experimentRepo.save(
        this.experimentRepo.create({
          experimentId: dto.experimentId,
          name: dto.name,
          variants: dto.variants as unknown as Record<string, unknown>[],
          confidenceLevel: cl,
          isSignificant,
          winningVariant: winner?.variantId ?? null,
          analysis: { tests, uplift },
        }),
      );
    }

    const winner = findWinner(variants);
    const overallUplift = relativeUplift(control.conversionRate, winner?.conversionRate ?? 0);
    const overallSignificant = tests.some((t) => t.isSignificant);

    return {
      experimentId: dto.experimentId,
      tests,
      recommendation: {
        action: this.recommend(overallSignificant, overallUplift),
        winningVariant: overallSignificant ? (winner?.variantId ?? null) : null,
        reason: overallSignificant
          ? `Statistically significant uplift of ${(overallUplift * 100).toFixed(1)}%`
          : 'No significant difference detected — continue collecting data',
        uplift: overallUplift,
        isSignificant: overallSignificant,
      },
    };
  }

  async getResult(experimentId: string): Promise<ExperimentResult | null> {
    return this.experimentRepo.findOne({
      where: { experimentId },
      order: { createdAt: 'DESC' },
    });
  }

  private recommend(isSignificant: boolean, uplift: number): 'adopt' | 'reject' | 'continue' {
    if (!isSignificant) return 'continue';
    return uplift > 0 ? 'adopt' : 'reject';
  }
}
