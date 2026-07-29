import { Module } from '@nestjs/common';
import { WalletStatusService } from './wallet-status.service';
import { WalletStatusController } from './wallet-status.controller';
import { AuthModule } from '../auth/auth.module';
import { StellarConfigService } from '../config/stellar.service';

@Module({
  imports: [AuthModule],
  controllers: [WalletStatusController],
  providers: [WalletStatusService, StellarConfigService],
  exports: [WalletStatusService],
})
export class WalletModule {}
