import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CurrencyConverterService } from '../currency-converter.service';

const DEFAULT_PAIRS = [
  { base: 'USD', quote: 'EUR' },
  { base: 'USD', quote: 'GBP' },
  { base: 'USD', quote: 'JPY' },
  { base: 'USD', quote: 'XLM' },
  { base: 'EUR', quote: 'USD' },
  { base: 'XLM', quote: 'USD' },
  { base: 'BTC', quote: 'USD' },
  { base: 'ETH', quote: 'USD' },
];

@Injectable()
export class UpdateExchangeRatesJob {
  private readonly logger = new Logger(UpdateExchangeRatesJob.name);

  constructor(private readonly currencyService: CurrencyConverterService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    this.logger.log('Refreshing exchange rates...');
    await this.currencyService.refreshRates(DEFAULT_PAIRS);
    this.logger.log('Exchange rates refreshed');
  }
}
