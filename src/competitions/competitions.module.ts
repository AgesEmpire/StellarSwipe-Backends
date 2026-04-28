import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Competition } from './entities/competition.entity';
import { PrizePool } from './entities/prize-pool.entity';
import { Participant } from './entities/participant.entity';
import { CompetitionTrade } from './entities/competition-trade.entity';
import { User } from '../users/entities/user.entity';
import { CompetitionService } from './competition.service';
import { CompetitionController } from './competition.controller';
import { ScoringEngineService } from './services/scoring-engine.service';
import { PrizeDistributorService } from './services/prize-distributor.service';
import { UpdateRankingsJob } from './jobs/update-rankings.job';
import { EndCompetitionJob } from './jobs/end-competition.job';
import { DistributePrizesJob } from './jobs/distribute-prizes.job';
import { COMPETITIONS_QUEUE } from './jobs/competitions-queue.constant';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Competition,
      PrizePool,
      Participant,
      CompetitionTrade,
      User,
    ]),
    BullModule.registerQueue({ name: COMPETITIONS_QUEUE }),
  ],
  controllers: [CompetitionController],
  providers: [
    CompetitionService,
    ScoringEngineService,
    PrizeDistributorService,
    UpdateRankingsJob,
    EndCompetitionJob,
    DistributePrizesJob,
  ],
  exports: [CompetitionService, ScoringEngineService, PrizeDistributorService],
})
export class CompetitionsModule {}
