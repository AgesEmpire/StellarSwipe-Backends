import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual } from 'typeorm';
import { Contest, ContestMetric, ContestStatus } from './entities/contest.entity';
import { Signal, SignalStatus } from '../signals/entities/signal.entity';
import { CreateContestDto, ContestEntryDto, ContestLeaderboardDto } from './dto/contest.dto';

interface ContestEntry {
  provider: string;
  signalsSubmitted: string[];
  totalRoi: number;
  successRate: number;
  totalVolume: number;
  followerCount: number;
}

@Injectable()
export class ContestsService {
  constructor(
    @InjectRepository(Contest)
    private readonly contestRepository: Repository<Contest>,
    @InjectRepository(Signal)
    private readonly signalRepository: Repository<Signal>,
  ) {}

  async createContest(dto: CreateContestDto): Promise<Contest> {
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);

    if (endTime <= startTime) {
      throw new BadRequestException('End time must be after start time');
    }

    const contest = this.contestRepository.create({
      name: dto.name,
      startTime,
      endTime,
      metric: dto.metric,
      minSignals: dto.minSignals,
      prizePool: dto.prizePool,
      status: ContestStatus.ACTIVE,
      winners: null,
    });

    return this.contestRepository.save(contest);
  }

  async getActiveContests(): Promise<Contest[]> {
    const now = new Date();
    return this.contestRepository.find({
      where: {
        status: ContestStatus.ACTIVE,
        startTime: LessThanOrEqual(now),
      },
      order: { startTime: 'DESC' },
    });
  }

  async getContest(id: string): Promise<Contest> {
    const contest = await this.contestRepository.findOne({ where: { id } });
    if (!contest) {
      throw new NotFoundException('Contest not found');
    }
    return contest;
  }

  async getContestLeaderboard(contestId: string): Promise<ContestLeaderboardDto> {
    const contest = await this.getContest(contestId);
    const entries = await this.calculateContestEntries(contest);
    
    const sortedEntries = entries
      .map(entry => ({
        provider: entry.provider,
        signalsSubmitted: entry.signalsSubmitted,
        totalRoi: entry.totalRoi.toFixed(8),
        successRate: entry.successRate,
        totalVolume: entry.totalVolume.toFixed(8),
        score: this.calculateScore(entry, contest.metric).toFixed(8),
      }))
      .sort((a, b) => parseFloat(b.score) - parseFloat(a.score));

    return {
      contestId: contest.id,
      contestName: contest.name,
      metric: contest.metric,
      entries: sortedEntries,
      winners: contest.winners,
      status: contest.status,
      endTime: contest.endTime,
    };
  }

  async finalizeContest(contestId: string): Promise<{ winners: string[]; prizes: Record<string, string> }> {
    const contest = await this.getContest(contestId);
    const now = new Date();

    if (now < contest.endTime) {
      throw new BadRequestException('Contest has not ended yet');
    }

    if (contest.status === ContestStatus.FINALIZED) {
      throw new BadRequestException('Contest already finalized');
    }

    const entries = await this.calculateContestEntries(contest);
    const qualifiedEntries = entries.filter(e => e.signalsSubmitted.length >= contest.minSignals);

    if (qualifiedEntries.length === 0) {
      contest.status = ContestStatus.FINALIZED;
      contest.winners = [];
      await this.contestRepository.save(contest);
      return { winners: [], prizes: {} };
    }

    const sortedEntries = qualifiedEntries
      .map(entry => ({
        provider: entry.provider,
        score: this.calculateScore(entry, contest.metric),
      }))
      .sort((a, b) => b.score - a.score);

    const winners = sortedEntries.slice(0, 3).map(e => e.provider);
    const prizes = this.distributePrizes(winners, contest.prizePool);

    contest.winners = winners;
    contest.status = ContestStatus.FINALIZED;
    await this.contestRepository.save(contest);

    return { winners, prizes };
  }

  private async calculateContestEntries(contest: Contest): Promise<ContestEntry[]> {
    const signals = await this.signalRepository.find({
      where: {
        createdAt: Between(contest.startTime, contest.endTime),
      },
      relations: ['provider'],
    });

    const entriesMap = new Map<string, ContestEntry>();

    for (const signal of signals) {
      const providerId = signal.providerId;
      
      if (!entriesMap.has(providerId)) {
        entriesMap.set(providerId, {
          provider: providerId,
          signalsSubmitted: [],
          totalRoi: 0,
          successRate: 0,
          totalVolume: 0,
          followerCount: 0,
        });
      }

      const entry = entriesMap.get(providerId)!;
      entry.signalsSubmitted.push(signal.id);

      if (signal.status === SignalStatus.CLOSED) {
        const roi = this.calculateSignalROI(signal);
        entry.totalRoi += roi;
        entry.totalVolume += parseFloat(signal.totalCopiedVolume || '0');
      }
    }

    for (const entry of entriesMap.values()) {
      const closedSignals = entry.signalsSubmitted.filter(id => {
        const signal = signals.find(s => s.id === id);
        return signal && signal.status === SignalStatus.CLOSED;
      });

      if (closedSignals.length > 0) {
        const successfulSignals = closedSignals.filter(id => {
          const signal = signals.find(s => s.id === id);
          return signal && parseFloat(signal.totalProfitLoss || '0') > 0;
        });
        entry.successRate = (successfulSignals.length / closedSignals.length) * 100;
      }
    }

    return Array.from(entriesMap.values());
  }

  private calculateSignalROI(signal: Signal): number {
    const entryPrice = parseFloat(signal.entryPrice || '0');
    const closePrice = parseFloat(signal.closePrice || '0');
    
    if (entryPrice === 0) return 0;
    
    return ((closePrice - entryPrice) / entryPrice) * 100;
  }

  private calculateScore(entry: ContestEntry, metric: ContestMetric): number {
    switch (metric) {
      case ContestMetric.HIGHEST_ROI:
        return entry.totalRoi;
      case ContestMetric.BEST_SUCCESS_RATE:
        return entry.successRate;
      case ContestMetric.MOST_VOLUME:
        return entry.totalVolume;
      case ContestMetric.MOST_FOLLOWERS:
        return entry.followerCount;
      default:
        return 0;
    }
  }

  private distributePrizes(winners: string[], prizePool: string): Record<string, string> {
    const total = parseFloat(prizePool);
    const prizes: Record<string, string> = {};

    if (winners.length >= 1) {
      prizes[winners[0]] = (total * 0.5).toFixed(8);
    }
    if (winners.length >= 2) {
      prizes[winners[1]] = (total * 0.3).toFixed(8);
    }
    if (winners.length >= 3) {
      prizes[winners[2]] = (total * 0.2).toFixed(8);
    }

    return prizes;
  }

  async getAllContests(status?: ContestStatus, limit: number = 50): Promise<Contest[]> {
    const query: any = {};
    if (status) {
      query.status = status;
    }

    return this.contestRepository.find({
      where: query,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
