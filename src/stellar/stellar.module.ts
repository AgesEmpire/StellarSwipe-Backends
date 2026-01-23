import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StellarConfigService } from '../config/stellar.service';
import { AccountManagerService } from './account/account-manager.service';
import { ReserveCalculatorService } from './account/reserve-calculator.service';
import { TrustlineService } from './trustlines/trustline.service';
import { TrustlineController } from './trustlines/trustline.controller';

@Module({
  imports: [ConfigModule],
  controllers: [TrustlineController],
  providers: [
    StellarConfigService,
    ReserveCalculatorService,
    AccountManagerService,
    TrustlineService,
  ],
  exports: [
    StellarConfigService,
    AccountManagerService,
    TrustlineService,
    ReserveCalculatorService,
  ],
})
export class StellarModule {}