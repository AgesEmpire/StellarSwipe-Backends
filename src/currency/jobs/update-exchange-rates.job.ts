import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CurrencyConverterService } from '../currency-converter.service';
import { DistributedLockService } from '../../common/services/distributed-lock.service';

const LOCK_KEY = 'update-exchange-rates';
const LOCK_TTL_MS = 3 * 60 * 1000; // 3 min — well above a normal rates-refresh cycle

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

  constructor(
    private readonly currencyService: CurrencyConverterService,
    private readonly distributedLock: DistributedLockService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    const { ran } = await this.distributedLock.withLock(
      LOCK_KEY,
      LOCK_TTL_MS,
      async () => {
        this.logger.log('Refreshing exchange rates...');
        await this.currencyService.refreshRates(DEFAULT_PAIRS);
        this.logger.log('Exchange rates refreshed');
      },
    );
    if (!ran) {
      this.logger.debug('Skipping exchange rate refresh — another replica is running it');
    }
  }
}
