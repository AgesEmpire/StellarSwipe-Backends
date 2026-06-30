import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ReputationScore } from './entities/reputation-score.entity';
import { ReputationScoringService } from './services/reputation-scoring.service';
import { UpdateReputationScoresJob } from './jobs/update-reputation-scores.job';
import { DistributedLockService } from '../common/services/distributed-lock.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReputationScore]),
    ScheduleModule.forRoot(),
  ],
  providers: [ReputationScoringService, UpdateReputationScoresJob, DistributedLockService],
  exports: [ReputationScoringService],
})
export class ProvidersModule {}
