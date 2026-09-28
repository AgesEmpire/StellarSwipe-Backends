import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from '@nestjs/cache-manager';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardRepository } from './leaderboard.repository';
import { Signal } from '../signals/entities/signal.entity';
import { CopiedPosition } from '../signals/entities/copied-position.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Signal, CopiedPosition, User]),
    ScheduleModule.forRoot(),
    CacheModule.register(),
  ],
  controllers: [LeaderboardController],
  providers: [LeaderboardService, LeaderboardRepository],
  exports: [LeaderboardService, LeaderboardRepository],
})
export class LeaderboardModule {}
