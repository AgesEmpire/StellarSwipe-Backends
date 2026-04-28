import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { ExchangeRate } from './entities/exchange-rate.entity';
import { CurrencyPreference } from './entities/currency-preference.entity';
import { CurrencyConverterService } from './currency-converter.service';
import { CurrencyController } from './currency.controller';
import { FixerIoProvider } from './providers/fixer-io.provider';
import { BaseForexProvider } from './providers/base-forex.provider';
import { UpdateExchangeRatesJob } from './jobs/update-exchange-rates.job';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExchangeRate, CurrencyPreference]),
    HttpModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [CurrencyController],
  providers: [
    CurrencyConverterService,
    UpdateExchangeRatesJob,
    FixerIoProvider,
    { provide: BaseForexProvider, useExisting: FixerIoProvider },
  ],
  exports: [CurrencyConverterService],
})
export class CurrencyModule {}
