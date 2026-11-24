import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trade } from '../entities/trade.entity';
import { TradesModule } from '../trades.module';
import { StellarConfigService } from '../../config/stellar.service';
import { CloseAllConfirmation } from './close-all-confirmation.entity';
import { CloseAllPositionsService } from './close-all.service';
import { CloseAllPositionsController } from './close-all.controller';
import { HorizonOrderbookQuoteSource } from './horizon-orderbook-quote.source';
import { TradesServicePositionCloser } from './trades-service-position.closer';
import { CLOSE_ALL_POSITION_CLOSER, CLOSE_QUOTE_SOURCE } from './close-all.types';

@Module({
  imports: [TypeOrmModule.forFeature([Trade, CloseAllConfirmation]), ConfigModule, TradesModule],
  controllers: [CloseAllPositionsController],
  providers: [
    StellarConfigService,
    CloseAllPositionsService,
    { provide: CLOSE_QUOTE_SOURCE, useClass: HorizonOrderbookQuoteSource },
    { provide: CLOSE_ALL_POSITION_CLOSER, useClass: TradesServicePositionCloser },
  ],
  exports: [CloseAllPositionsService],
})
export class CloseAllPositionsModule {}
