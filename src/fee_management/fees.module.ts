import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { FeesService } from './fees.service';
import { FeesController } from './fees.controller';
import { FeeTransaction } from './entities/fee-transaction.entity';
import { FeeTier } from './entities/fee-tier.entity';
import {
  FeePromotion,
  FeePromotionRedemption,
} from './entities/fee-promotion.entity';
import { FeeManagerService } from './fee-manager.service';
import { FeeCalculatorService } from './fee-calculator.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeeTransaction,
      FeeTier,
      FeePromotion,
      FeePromotionRedemption,
    ]),
    ConfigModule,
  ],
  controllers: [FeesController],
  providers: [FeesService, FeeManagerService, FeeCalculatorService],
  exports: [FeesService, FeeManagerService, FeeCalculatorService],
})
export class FeesModule {}
