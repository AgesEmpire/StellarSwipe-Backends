import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PriceOracleService } from './price-oracle.service';
import { PriceOracleController } from './price-oracle.controller';
import { PriceHistory } from './entities/price-history.entity';
import { SdexPriceProvider } from './providers/sdex-price.provider';
import { CoinGeckoPriceProvider } from './providers/coingecko-price.provider';
import { StellarExpertPriceProvider } from './providers/stellar-expert-price.provider';
import { HttpRetryModule } from '../http/http.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PriceHistory]),
    HttpRetryModule,
    CacheModule.register({
      ttl: 60000, // 60 seconds
      max: 100,
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
  ],
  controllers: [PriceOracleController],
  providers: [
    PriceOracleService,
    SdexPriceProvider,
    CoinGeckoPriceProvider,
    StellarExpertPriceProvider,
  ],
  exports: [PriceOracleService],
})
export class PriceOracleModule {}
