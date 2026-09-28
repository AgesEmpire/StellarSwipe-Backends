import { PriceCacheRefreshService } from './price-cache-refresh.service';
import { PriceHistory } from '../../prices/entities/price-history.entity';

function makeRepo(rows: PriceHistory[] = []) {
  return {
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(
        rows.length > 0
          ? Array.from(new Set(rows.map((row) => row.assetPair))).map((assetPair) => ({ assetPair }))
          : [],
      ),
    }),
    find: jest.fn().mockResolvedValue(rows),
  };
}

describe('PriceCacheRefreshService', () => {
  it('refreshes each asset pair and writes the warm cache', async () => {
    const rows = [
      {
        id: '1',
        assetPair: 'XLM-USDC',
        price: 0.123,
        source: 'aggregated',
        metadata: { pricesUsed: [0.123] },
        timestamp: new Date(),
        createdAt: new Date(),
      },
    ] as PriceHistory[];
    const cacheManager = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const service = new PriceCacheRefreshService(
      makeRepo(rows) as any,
      cacheManager as any,
    );

    const result = await service.refreshAssetPair('XLM-USDC');

    expect(result.refreshed).toBe(true);
    expect(cacheManager.set).toHaveBeenCalled();
  });

  it('retries partial failures before succeeding', async () => {
    let attempts = 0;
    const cacheManager = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const repo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ assetPair: 'BTC-USDC' }]),
      }),
      find: jest.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('transient failure');
        }
        return [
          {
            id: '2',
            assetPair: 'BTC-USDC',
            price: 1,
            source: 'aggregated',
            metadata: { pricesUsed: [1] },
            timestamp: new Date(),
            createdAt: new Date(),
          },
        ] as PriceHistory[];
      }),
    };
    const service = new PriceCacheRefreshService(repo as any, cacheManager as any);

    const result = await service.refreshAssetPair('BTC-USDC');

    expect(result.refreshed).toBe(true);
    expect(result.attempts).toBeGreaterThan(1);
  });

  it('summarizes a full refresh across all pairs', async () => {
    const cacheManager = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const repo = makeRepo([
      {
        id: '1',
        assetPair: 'ETH-USDC',
        price: 1,
        source: 'aggregated',
        metadata: { pricesUsed: [1] },
        timestamp: new Date(),
        createdAt: new Date(),
      } as PriceHistory,
    ]);
    const service = new PriceCacheRefreshService(repo as any, cacheManager as any);

    const summary = await service.refreshHistoricalPriceCaches();

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].assetPair).toBe('ETH-USDC');
  });
});
