import { Module } from '@nestjs/common';
import { WalletValidationService } from './wallet-validation.service';
import { WalletValidationController } from './wallet-validation.controller';

@Module({
  providers: [WalletValidationService],
  controllers: [WalletValidationController],
  exports: [WalletValidationService],
})
export class WalletValidationModule {}