import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiskSettings } from './entities/risk-settings.entity';
import { TransactionLimit } from './velocity/entities/transaction-limit.entity';
import { RiskManagerService } from './risk-manager.service';
import { VelocityCheckerService } from './velocity/velocity-checker.service';
import { TransactionLimitsService } from './velocity/transaction-limits.service';

@Module({
  imports: [TypeOrmModule.forFeature([RiskSettings, TransactionLimit])],
  providers: [RiskManagerService, VelocityCheckerService, TransactionLimitsService],
  exports: [RiskManagerService, VelocityCheckerService, TransactionLimitsService],
})
export class RiskManagerModule {}
