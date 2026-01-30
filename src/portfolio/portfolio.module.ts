import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { Trade } from '../trades/entities/trade.entity';
import { Position } from './entities/position.entity';
import { PnlHistory } from './entities/pnl-history.entity';
import { User } from '../users/entities/user.entity';
import { PriceService } from '../shared/price.service';
import { CacheModule } from '@nestjs/cache-manager';
import { PnlCalculatorService } from './services/pnl-calculator.service';
import { PerformanceTrackerService } from './services/performance-tracker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trade, Position, User, PnlHistory]),
    CacheModule.register(),
  ],
  controllers: [PortfolioController],
  providers: [PortfolioService, PriceService, PnlCalculatorService, PerformanceTrackerService],
  exports: [PortfolioService, PnlCalculatorService, PerformanceTrackerService],
})
export class PortfolioModule {}
