import { Module } from '@nestjs/common';
import { SlippageCalculatorService } from './slippage-calculator.service';
import { SlippageProtectionService } from './slippage-protection.service';

@Module({
  providers: [
    SlippageCalculatorService,
    SlippageProtectionService,
  ],
  exports: [
    SlippageCalculatorService,
    SlippageProtectionService,
  ],
})
export class SlippageModule {}