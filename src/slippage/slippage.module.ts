import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PriceHistory } from '../prices/entities/price-history.entity';
import { OrderBookService } from './order-book.service';
import { SlippageCalculatorService } from './slippage-calculator.service';
import { SlippageProtectionService } from './slippage-protection.service';
import { VolatilityService } from './volatility.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([PriceHistory])],
  providers: [
    OrderBookService,
    SlippageCalculatorService,
    SlippageProtectionService,
    VolatilityService,
  ],
  exports: [
    OrderBookService,
    SlippageCalculatorService,
    SlippageProtectionService,
    VolatilityService,
  ],
})
export class SlippageModule {}
