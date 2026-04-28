import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserLtv } from './entities/user-ltv.entity';
import { LtvSegment } from './entities/ltv-segment.entity';
import { LtvCalculationDto } from './dto/ltv-calculation.dto';
import { RevenueForecastDto } from './dto/revenue-forecast.dto';
import { LtvResult } from './interfaces/ltv-model.interface';
import { calculateHistoricalLtv } from './calculators/historical-ltv.calculator';
import { calculatePredictiveLtv, forecastMonthly } from './calculators/predictive-ltv.calculator';
import { calculateCohortLtv } from './calculators/cohort-ltv.calculator';

@Injectable()
export class LtvCalculatorService {
  constructor(
    @InjectRepository(UserLtv)
    private readonly ltvRepo: Repository<UserLtv>,
    @InjectRepository(LtvSegment)
    private readonly segmentRepo: Repository<LtvSegment>,
  ) {}

  async calculate(dto: LtvCalculationDto, forecastMonths = 12): Promise<LtvResult> {
    const historical = calculateHistoricalLtv(dto);
    const predicted = calculatePredictiveLtv(dto, forecastMonths);
    const cohort = calculateCohortLtv(dto);
    const segment = predicted >= 500 ? 'high' : predicted >= 100 ? 'medium' : 'low';
    const confidence = Math.min(1, 0.5 + dto.monthsActive * 0.02 + dto.engagementScore * 0.3);

    await this.ltvRepo.upsert(
      {
        userId: dto.userId,
        predictedLtv: predicted,
        historicalLtv: historical,
        cohortLtv: cohort,
        subscriptionTier: dto.subscriptionTier,
        forecastMonths,
        confidence,
        segment,
        metadata: { ...dto } as unknown as Record<string, unknown>,
      },
      ['userId'],
    );

    return { userId: dto.userId, predictedLtv: predicted, historicalLtv: historical, cohortLtv: cohort, segment, forecastMonths, confidence };
  }

  async forecast(dto: LtvCalculationDto, forecastMonths = 12): Promise<RevenueForecastDto> {
    const monthlyForecasts = forecastMonthly(dto, forecastMonths);
    const totalForecast = monthlyForecasts[monthlyForecasts.length - 1]?.cumulative ?? 0;
    const confidence = Math.min(1, 0.5 + dto.monthsActive * 0.02 + dto.engagementScore * 0.3);
    return { userId: dto.userId, forecastMonths, monthlyForecasts, totalForecast, confidence };
  }

  async getByUser(userId: string): Promise<UserLtv | null> {
    return this.ltvRepo.findOne({ where: { userId } });
  }

  async getSegments() {
    return this.segmentRepo.find();
  }
}
