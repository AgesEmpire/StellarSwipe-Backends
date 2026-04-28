import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';

import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { RebalancingService } from './services/rebalancing.service';
import { CheckRebalancingJob } from './jobs/check-rebalancing.job';

import { Trade } from '../trades/entities/trade.entity';
import { Position } from './entities/position.entity';
import { PnlHistory } from './entities/pnl-history.entity';
import { User } from '../users/entities/user.entity';
import { PriceService } from '../shared/price.service';
import { PnlCalculatorService } from './services/pnl-calculator.service';
import { PerformanceTrackerService } from './services/performance-tracker.service';
import { ExportService } from './services/export.service';
import { NotificationService } from '../common/services/notification.service';
import { RateLimitService } from '../common/services/rate-limit.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trade, Position, User, PnlHistory]),
    BullModule.registerQueue({ name: 'export-history' }),
  ],
  controllers: [PortfolioController],
  providers: [
    PortfolioService,
    PriceService,
    PnlCalculatorService,
    PerformanceTrackerService,
    ExportService,
    NotificationService,
    RateLimitService,
    RebalancingService,
    CheckRebalancingJob,
  ],
  exports: [PortfolioService, PnlCalculatorService, PerformanceTrackerService, ExportService],
})
export class PortfolioModule {}
