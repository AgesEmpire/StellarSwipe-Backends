import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trade } from './entities/trade.entity';
import { TradesController } from './trades.controller';
import { TradesService } from './trades.service';
import { RiskManagerService } from './services/risk-manager.service';
import { TradeExecutorService } from './services/trade-executor.service';
import { StellarConfigService } from '../config/stellar.service';
import { RiskManagerModule } from '../risk/risk-manager.module';

@Module({
  imports: [TypeOrmModule.forFeature([Trade]), RiskManagerModule],
  controllers: [TradesController],
  providers: [
    TradesService,
    RiskManagerService,
    TradeExecutorService,
    StellarConfigService,
  ],
  exports: [TradesService, RiskManagerService],
})
export class TradesModule {}
