import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContestsController } from './contests.controller';
import { ContestsService } from './contests.service';
import { Contest } from './entities/contest.entity';
import { Signal } from '../signals/entities/signal.entity';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contest, Signal]),
    AuthorizationModule,
  ],
  controllers: [ContestsController],
  providers: [ContestsService],
  exports: [ContestsService],
})
export class ContestsModule {}
