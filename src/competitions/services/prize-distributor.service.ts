import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Competition, CompetitionStatus } from '../entities/competition.entity';
import { PrizePool } from '../entities/prize-pool.entity';
import { Participant, ParticipantStatus } from '../entities/participant.entity';
import { PrizeDistributionDto } from '../dto/prize-distribution.dto';

export interface DistributionLine {
  participantId: string;
  userId: string;
  rank: number;
  amount: string;
}

@Injectable()
export class PrizeDistributorService {
  private readonly logger = new Logger(PrizeDistributorService.name);

  constructor(
    @InjectRepository(Competition)
    private readonly competitionRepository: Repository<Competition>,
    @InjectRepository(PrizePool)
    private readonly prizePoolRepository: Repository<PrizePool>,
    @InjectRepository(Participant)
    private readonly participantRepository: Repository<Participant>,
  ) {}

  async planDistribution(dto: PrizeDistributionDto): Promise<DistributionLine[]> {
    const competition = await this.competitionRepository.findOne({
      where: { id: dto.competitionId },
      relations: ['prizePool'],
    });
    if (!competition?.prizePool) {
      throw new Error('Competition or prize pool not found');
    }
    const poolTotal = parseFloat(competition.prizePool.totalAmount) || 0;
    const lines: DistributionLine[] = [];
    for (const placement of dto.placements) {
      const participant = await this.participantRepository.findOne({
        where: {
          competition: { id: dto.competitionId },
          rank: placement.rank,
          status: ParticipantStatus.ACTIVE,
        },
        relations: ['user'],
      });
      if (!participant) {
        this.logger.warn(`No participant at rank ${placement.rank} for competition ${dto.competitionId}`);
        continue;
      }
      const amount = (poolTotal * placement.share).toFixed(8);
      lines.push({
        participantId: participant.id,
        userId: participant.user.id,
        rank: placement.rank,
        amount,
      });
    }
    return lines;
  }

  async markPoolDistributed(competitionId: string): Promise<void> {
    const competition = await this.competitionRepository.findOne({
      where: { id: competitionId },
      relations: ['prizePool'],
    });
    if (!competition?.prizePool) return;
    competition.prizePool.distributedAt = new Date();
    await this.prizePoolRepository.save(competition.prizePool);
    competition.status = CompetitionStatus.PRIZES_DISTRIBUTED;
    await this.competitionRepository.save(competition);
  }
}
