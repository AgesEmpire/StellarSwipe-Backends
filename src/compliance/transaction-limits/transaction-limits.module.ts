import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionLimit } from './entities/transaction-limit.entity';
import { TransactionUsage } from './entities/transaction-usage.entity';
import { TransactionLimitsService } from './transaction-limits.service';
import { TransactionLimitGuard } from './guards/transaction-limit.guard';
import { AuditModule } from '../../audit-log/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionLimit, TransactionUsage]),
    AuditModule,
  ],
  providers: [TransactionLimitsService, TransactionLimitGuard],
  exports: [TransactionLimitsService, TransactionLimitGuard],
})
export class TransactionLimitsModule {}
