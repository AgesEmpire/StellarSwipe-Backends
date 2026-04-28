import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Competition, CompetitionStatus } from './entities/competition.entity';
import { Participant, ParticipantStatus } from './entities/participant.entity';
import { CompetitionTrade } from './entities/competition-trade.entity';
import { PrizePool } from './entities/prize-pool.entity';
import { User } from '../users/entities/user.entity';
import { CreateCompetitionDto } from './dto/create-competition.dto';
import {
  CompetitionLeaderboardDto,
  CompetitionLeaderboardEntryDto,
} from './dto/competition-leaderboard.dto';
import { ScoringEngineService } from './services/scoring-engine.service';
import { assignRanks } from './utils/rank-calculator';

@Injectable()
export class CompetitionService {
  constructor(
    @InjectRepository(Competition)
    private readonly competitionRepository: Repository<Competition>,
    @InjectRepository(Participant)
    private readonly participantRepository: Repository<Participant>,
    @InjectRepository(CompetitionTrade)
    private readonly tradeRepository: Repository<CompetitionTrade>,
    @InjectRepository(PrizePool)
    private readonly prizePoolRepository: Repository<PrizePool>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly scoringEngine: ScoringEngineService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(dto: CreateCompetitionDto): Promise<Competition> {
    if (dto.endsAt <= dto.startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }
    const competition = this.competitionRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
      status: CompetitionStatus.SCHEDULED,
      rules: dto.rules ?? {},
      scoringMetric: dto.scoringMetric ?? 'PNL',
    });
    await this.competitionRepository.save(competition);
    const pool = this.prizePoolRepository.create({
      totalAmount: dto.prizePoolTotal,
      currency: dto.currency ?? 'USDC',
      distributionRulesJson: dto.distributionRules ?? [],
      competition,
    });
    await this.prizePoolRepository.save(pool);
    return this.competitionRepository.findOneOrFail({
      where: { id: competition.id },
      relations: ['prizePool'],
    });
  }

  async findOne(id: string): Promise<Competition> {
    const c = await this.competitionRepository.findOne({
      where: { id },
      relations: ['prizePool'],
    });
    if (!c) throw new NotFoundException('Competition not found');
    return c;
  }

  async listLive(): Promise<Competition[]> {
    const now = new Date();
    return this.competitionRepository.find({
      where: { status: CompetitionStatus.LIVE },
      relations: ['prizePool'],
      order: { endsAt: 'ASC' },
    });
  }

  async join(competitionId: string, userId: string): Promise<Participant> {
    const competition = await this.findOne(competitionId);
    if (competition.status !== CompetitionStatus.LIVE) {
      throw new BadRequestException('Competition is not open for joining');
    }
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const existing = await this.participantRepository.findOne({
      where: {
        competition: { id: competitionId },
        user: { id: userId },
      },
    });
    if (existing) return existing;
    const participant = this.participantRepository.create({
      competition: { id: competitionId } as Competition,
      user: { id: userId } as User,
      joinedAt: new Date(),
      currentScore: 0,
      rank: null,
      status: ParticipantStatus.ACTIVE,
    });
    return this.participantRepository.save(participant);
  }

  async recordTrade(input: {
    competitionId: string;
    userId: string;
    volume: string;
    realizedPnl: string;
    assetPair?: string;
    externalTradeId?: string;
    recordedAt?: Date;
  }): Promise<CompetitionTrade> {
    const participant = await this.participantRepository.findOne({
      where: {
        competition: { id: input.competitionId },
        user: { id: input.userId },
        status: ParticipantStatus.ACTIVE,
      },
    });
    if (!participant) {
      throw new BadRequestException('User is not an active participant');
    }
    const trade = this.tradeRepository.create({
      participant,
      volume: input.volume,
      realizedPnl: input.realizedPnl,
      assetPair: input.assetPair ?? null,
      externalTradeId: input.externalTradeId ?? null,
      recordedAt: input.recordedAt ?? new Date(),
    });
    return this.tradeRepository.save(trade);
  }

  async getLeaderboard(competitionId: string): Promise<CompetitionLeaderboardDto> {
    const competition = await this.findOne(competitionId);
    const participants = await this.participantRepository.find({
      where: {
        competition: { id: competitionId },
        status: ParticipantStatus.ACTIVE,
      },
      relations: ['user'],
      order: { rank: 'ASC', currentScore: 'DESC' },
    });
    const entries: CompetitionLeaderboardEntryDto[] = [];
    for (const p of participants) {
      const tradeCount = await this.tradeRepository.count({
        where: { participant: { id: p.id } },
      });
      entries.push({
        participantId: p.id,
        userId: p.user.id,
        username: p.user.username,
        rank: p.rank ?? 0,
        score: p.currentScore,
        tradeCount,
      });
    }
    return {
      competitionId: competition.id,
      competitionName: competition.name,
      status: competition.status,
      updatedAt: new Date(),
      entries,
    };
  }

  async updateRankingsForLiveCompetitions(): Promise<void> {
    const live = await this.listLive();
    for (const competition of live) {
      await this.recomputeRanks(competition.id, competition.scoringMetric);
      const board = await this.getLeaderboard(competition.id);
      this.eventEmitter.emit('competition.leaderboard.updated', board);
    }
  }

  async recomputeRanks(competitionId: string, scoringMetric: string): Promise<void> {
    const participants = await this.participantRepository.find({
      where: {
        competition: { id: competitionId },
        status: ParticipantStatus.ACTIVE,
      },
    });
    if (participants.length === 0) return;
    const scores = new Map<string, number>();
    for (const p of participants) {
      const trades = await this.tradeRepository.find({
        where: { participant: { id: p.id } },
      });
      const score = this.scoringEngine.scoreParticipant(scoringMetric, p, trades);
      scores.set(p.id, score);
      p.currentScore = score;
      await this.participantRepository.save(p);
    }
    const rankMap = assignRanks(participants, (p) => scores.get(p.id) ?? 0, true);
    for (const p of participants) {
      p.rank = rankMap.get(p) ?? null;
      await this.participantRepository.save(p);
    }
  }

  async syncCompetitionLifecycle(): Promise<void> {
    const now = new Date();
    const scheduled = await this.competitionRepository.find({
      where: {
        status: CompetitionStatus.SCHEDULED,
      },
    });
    for (const c of scheduled) {
      if (c.startsAt <= now && c.endsAt > now) {
        c.status = CompetitionStatus.LIVE;
        await this.competitionRepository.save(c);
      } else if (c.endsAt <= now) {
        c.status = CompetitionStatus.ENDED;
        await this.competitionRepository.save(c);
      }
    }
    const live = await this.competitionRepository.find({
      where: { status: CompetitionStatus.LIVE },
    });
    for (const c of live) {
      if (c.endsAt <= now) {
        c.status = CompetitionStatus.ENDED;
        await this.competitionRepository.save(c);
        await this.recomputeRanks(c.id, c.scoringMetric);
      }
    }
  }
}
