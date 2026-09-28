import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Trade } from '../../trades/entities/trade.entity';
import { Signal } from '../../signals/entities/signal.entity';
import { Cohort } from './entities/cohort.entity';
import { CohortMetric } from './entities/cohort-metric.entity';
import { CohortAnalysisDto, CohortBucketDto } from './dto/cohort-analysis.dto';
import { CohortQueryDto } from './dto/cohort-query.dto';
import { RetentionMatrixDto } from './dto/retention-matrix.dto';
import { buildCohortKey, getPeriodDiff } from './utils/cohort-builder';
import { calculateRetentionRates } from './utils/retention-calculator';
import { CohortType } from './interfaces/cohort-config.interface';

type UserTradeSummary = {
  userId: string;
  userCreatedAt: Date;
  firstTradeAt: Date | null;
  providerId: string | null;
  activityDates: Date[];
};

@Injectable()
export class CohortAnalyzerService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    @InjectRepository(Signal)
    private readonly signalRepo: Repository<Signal>,
    @InjectRepository(Cohort)
    private readonly cohortRepo: Repository<Cohort>,
    @InjectRepository(CohortMetric)
    private readonly metricRepo: Repository<CohortMetric>,
  ) {}

  async analyze(query: CohortQueryDto): Promise<CohortAnalysisDto> {
    const cohortType: CohortType = query.cohortType ?? 'signup_period';
    const period = query.period ?? 'month';
    const retentionPeriods = query.retentionPeriods ?? 6;

    const summaries = await this.getUserTradeSummaries(query.providerId);
    const grouped = new Map<string, UserTradeSummary[]>();

    for (const row of summaries) {
      const cohortKey = buildCohortKey({
        cohortType,
        userCreatedAt: row.userCreatedAt,
        firstTradeAt: row.firstTradeAt,
        providerId: row.providerId,
        period,
      });
      const existing = grouped.get(cohortKey) ?? [];
      existing.push(row);
      grouped.set(cohortKey, existing);
    }

    const cohorts: CohortBucketDto[] = [];
    for (const [cohortKey, members] of grouped.entries()) {
      const cohortStart = this.resolveCohortStartDate(cohortType, members);
      const activeUsersByPeriod = this.buildActiveUsersByPeriod(members, cohortStart, period, retentionPeriods);
      const retentionRates = calculateRetentionRates(activeUsersByPeriod, members.length);

      cohorts.push({
        cohortKey,
        cohortType,
        cohortSize: members.length,
        activeUsersByPeriod,
        retentionRates,
      });
    }

    cohorts.sort((a, b) => a.cohortKey.localeCompare(b.cohortKey));
    await this.persistSnapshots(cohorts, cohortType);

    return {
      generatedAt: new Date().toISOString(),
      period,
      retentionPeriods,
      cohorts,
    };
  }

  async getRetentionMatrix(query: CohortQueryDto): Promise<RetentionMatrixDto> {
    const analysis = await this.analyze(query);
    return {
      xAxis: Array.from({ length: analysis.retentionPeriods }, (_, index) => `P${index}`),
      yAxis: analysis.cohorts.map((cohort) => cohort.cohortKey),
      values: analysis.cohorts.map((cohort) => cohort.retentionRates),
    };
  }

  private async getUserTradeSummaries(providerId?: string): Promise<UserTradeSummary[]> {
    const users = await this.userRepo.find({ select: { id: true, createdAt: true } });
    if (users.length === 0) {
      return [];
    }

    const userIds = users.map((user) => user.id);
    const trades = await this.tradeRepo.find({
      where: { userId: In(userIds) },
      select: { userId: true, signalId: true, createdAt: true },
    });
    const filteredTrades = trades;

    const signalIds = Array.from(new Set(filteredTrades.map((trade) => trade.signalId)));
    const signals = signalIds.length
      ? await this.signalRepo.find({
          where: { id: In(signalIds) },
          select: { id: true, providerId: true },
        })
      : [];
    const signalProviderMap = new Map(signals.map((signal) => [signal.id, signal.providerId]));

    const tradeMap = new Map<string, UserTradeSummary>();
    for (const user of users) {
      tradeMap.set(user.id, {
        userId: user.id,
        userCreatedAt: user.createdAt,
        firstTradeAt: null,
        providerId: null,
        activityDates: [],
      });
    }

    for (const trade of filteredTrades) {
      const userSummary = tradeMap.get(trade.userId);
      if (!userSummary) {
        continue;
      }
      userSummary.activityDates.push(trade.createdAt);
      if (!userSummary.firstTradeAt || trade.createdAt < userSummary.firstTradeAt) {
        userSummary.firstTradeAt = trade.createdAt;
      }
      if (!userSummary.providerId) {
        userSummary.providerId = signalProviderMap.get(trade.signalId) ?? null;
      }
    }

    const summaries = Array.from(tradeMap.values());
    if (!providerId) {
      return summaries;
    }
    return summaries.filter((summary) => summary.providerId === providerId);
  }

  private buildActiveUsersByPeriod(
    members: UserTradeSummary[],
    cohortStart: Date,
    period: 'day' | 'week' | 'month',
    retentionPeriods: number,
  ): number[] {
    const buckets = Array.from({ length: retentionPeriods }, () => 0);
    for (let periodIndex = 0; periodIndex < retentionPeriods; periodIndex += 1) {
      const activeCount = members.reduce((count, member) => {
        const wasActive = member.activityDates.some(
          (activityDate) => getPeriodDiff(cohortStart, activityDate, period) === periodIndex,
        );
        return count + (wasActive ? 1 : 0);
      }, 0);
      buckets[periodIndex] = activeCount;
    }
    return buckets;
  }

  private resolveCohortStartDate(cohortType: CohortType, members: UserTradeSummary[]): Date {
    if (cohortType === 'signup_period') {
      return members.reduce((minDate, member) => (member.userCreatedAt < minDate ? member.userCreatedAt : minDate), members[0].userCreatedAt);
    }
    if (cohortType === 'first_trade_period') {
      const firstTradeDates = members.map((member) => member.firstTradeAt).filter((value): value is Date => value instanceof Date);
      return firstTradeDates[0] ?? members[0].userCreatedAt;
    }
    return members[0].userCreatedAt;
  }

  private async persistSnapshots(cohorts: CohortBucketDto[], cohortType: CohortType): Promise<void> {
    for (const cohort of cohorts) {
      await this.cohortRepo.upsert(
        {
          cohortType,
          cohortKey: cohort.cohortKey,
          cohortSize: cohort.cohortSize,
          metadata: { generatedAt: new Date().toISOString() },
        },
        ['cohortType', 'cohortKey'],
      );
      for (let periodIndex = 0; periodIndex < cohort.retentionRates.length; periodIndex += 1) {
        await this.metricRepo.upsert(
          {
            cohortType,
            cohortKey: cohort.cohortKey,
            periodIndex,
            activeUsers: cohort.activeUsersByPeriod[periodIndex] ?? 0,
            retentionRate: cohort.retentionRates[periodIndex] ?? 0,
          },
          ['cohortType', 'cohortKey', 'periodIndex'],
        );
      }
    }
  }
}
