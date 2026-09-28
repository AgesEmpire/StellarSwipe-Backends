import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FraudScoringService } from './fraud-scoring.service';
import { FraudRule } from './entities/fraud-rule.entity';
import { FraudScore } from './entities/fraud-score.entity';

@Module({
  imports: [TypeOrmModule.forFeature([FraudRule, FraudScore])],
  providers: [FraudScoringService],
  exports: [FraudScoringService],
})
export class FraudScoringModule {}
