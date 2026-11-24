import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContestsController } from './contests.controller';
import { ContestsService } from './contests.service';
import { Contest } from './entities/contest.entity';
import {
  ContestResultCorrection,
  ContestTradeEvent,
} from './entities/contest-trade-event.entity';
import { ContestResultIntegrityService } from './contest-result-integrity.service';
import { ContestResultsController } from './contest-results.controller';
import { Signal } from '../signals/entities/signal.entity';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contest, Signal, ContestTradeEvent, ContestResultCorrection]),
    AuthorizationModule,
  ],
  controllers: [ContestsController, ContestResultsController],
  providers: [ContestsService, ContestResultIntegrityService],
  exports: [ContestsService, ContestResultIntegrityService],
})
export class ContestsModule {}
