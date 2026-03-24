import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { AggregatorController } from './aggregator.controller';
import { AggregatorService } from './aggregator.service';

import { LobstrDexAdapter } from './dexes/lobstr-dex.adapter';
import { StellarxDexAdapter } from './dexes/stellarx-dex.adapter';
import { StellarTermDexAdapter } from './dexes/stellarterm-dex.adapter';

import { QuoteAggregatorService } from './services/quote-aggregator.service';
import { RouteOptimizerService } from './services/route-optimizer.service';

import { DexRouteEntity } from './entities/dex-route.entity';
import { LiquidityPoolEntity } from './entities/liquidity-pool.entity';

@Module({
  imports: [
    ConfigModule,
    HttpModule.register({
      timeout: 8000,
      maxRedirects: 3,
    }),
    TypeOrmModule.forFeature([DexRouteEntity, LiquidityPoolEntity]),
  ],
  controllers: [AggregatorController],
  providers: [
    AggregatorService,
    LobstrDexAdapter,
    StellarxDexAdapter,
    StellarTermDexAdapter,
    QuoteAggregatorService,
    RouteOptimizerService,
  ],
  exports: [AggregatorService],
})
export class DexAggregatorModule {}
