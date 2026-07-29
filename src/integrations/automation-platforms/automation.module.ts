import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ZapierService } from './zapier.service';
import { MakeService } from './make.service';
import { AutomationController } from './automation.controller';
import { SignalsModule } from '../../signals/signals.module';
import { TradesModule } from '../../trades/trades.module';
import { PortfolioModule } from '../../portfolio/portfolio.module';

@Module({
  imports: [HttpModule, SignalsModule, TradesModule, PortfolioModule],
  controllers: [AutomationController],
  providers: [ZapierService, MakeService],
  exports: [ZapierService, MakeService],
})
export class AutomationModule {}
