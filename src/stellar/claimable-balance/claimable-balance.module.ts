import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClaimableBalanceService } from './claimable-balance.service';
import { ClaimableBalanceController } from './claimable-balance.controller';

@Module({
  imports: [ConfigModule],
  controllers: [ClaimableBalanceController],
  providers: [ClaimableBalanceService],
  exports: [ClaimableBalanceService],
})
export class ClaimableBalanceModule {}
