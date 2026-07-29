import { RefreshHistoricalPricesJob } from './jobs/refresh-historical-prices.job';

describe('RefreshHistoricalPricesJob', () => {
  it('registers the job with the configured scheduler', () => {
    const scheduler = { register: jest.fn() } as any;
    const refreshService = { refreshHistoricalPriceCaches: jest.fn() } as any;

    const job = new RefreshHistoricalPricesJob(scheduler, refreshService);
    job.onModuleInit();

    expect(scheduler.register).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'market-data.refresh-historical-prices',
        cronEnvKey: 'CRON_REFRESH_HISTORICAL_PRICES',
      }),
    );
  });

  it('delegates execution to the refresh service', async () => {
    const scheduler = { register: jest.fn() } as any;
    const refreshService = { refreshHistoricalPriceCaches: jest.fn().mockResolvedValue(undefined) } as any;

    const job = new RefreshHistoricalPricesJob(scheduler, refreshService);
    await job.run();

    expect(refreshService.refreshHistoricalPriceCaches).toHaveBeenCalled();
  });
});
