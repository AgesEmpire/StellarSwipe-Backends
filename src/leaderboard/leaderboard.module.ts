import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from '@nestjs/cache-manager';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardController } from './leaderboard.controller';

// Replace these with the actual entity classes used in your project
import { Signal } from '../signals/signal.entity';
import { Provider } from '../providers/provider.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Signal, Provider]),
    ScheduleModule.forRoot(),
    CacheModule.register(),
  ],
  controllers: [LeaderboardController],
  providers: [LeaderboardService],
  exports: [LeaderboardService],
})
export class LeaderboardModule {}
