import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { Achievement } from './entities/achievement.entity';
import { UserAchievement } from './entities/user-achievement.entity';
import { AchievementsService } from './achievements.service';
import { AchievementsController } from './achievements.controller';
import { AchievementEventListener } from './listeners/achievement-event.listener';

@Module({
  imports: [
    TypeOrmModule.forFeature([Achievement, UserAchievement]),
    // EventEmitterModule is imported here so this module can be used
    // standalone; the root AppModule should still call
    // EventEmitterModule.forRoot() once.
    EventEmitterModule,
  ],
  providers: [AchievementsService, AchievementEventListener],
  controllers: [AchievementsController],
  exports: [AchievementsService], // Export so other modules can emit events
})
export class AchievementsModule {}
