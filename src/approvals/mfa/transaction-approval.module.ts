import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionApprovalService } from './transaction-approval.service';
import { TransactionApproval } from './entities/transaction-approval.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TransactionApproval])],
  providers: [TransactionApprovalService],
  exports: [TransactionApprovalService],
})
export class TransactionApprovalModule {}
