import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { ZapierService } from './zapier.service';
import { MakeService } from './make.service';
import { AutomationController } from './automation.controller';
import { SignalsModule } from '../../signals/signals.module';
import { TradesModule } from '../../trades/trades.module';
import { PortfolioModule } from '../../portfolio/portfolio.module';
import { WebhookVerifierService } from '../webhooks/webhook-verifier.service';

@Module({
  imports: [ConfigModule, HttpModule, SignalsModule, TradesModule, PortfolioModule],
  controllers: [AutomationController],
  providers: [ZapierService, MakeService, WebhookVerifierService],
  exports: [ZapierService, MakeService],
})
export class AutomationModule {}
