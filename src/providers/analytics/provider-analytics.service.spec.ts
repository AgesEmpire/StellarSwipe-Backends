import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

import { ProviderAnalyticsService } from './provider-analytics.service';
import { Signal } from '../../signals/entities/signal.entity';
import { Trade } from '../../trades/entities/trade.entity';
import { ProviderEarning } from '../../provider-rewards/provider-earning.entity';

describe('ProviderAnalyticsService', () => {
  const cache = new Map<string, unknown>();

  const signalRepo = {
    find: jest.fn(),
  };
  const tradeRepo = {
    find: jest.fn(),
  };
  const earningRepo = {
    find: jest.fn(),
  };

  let service: ProviderAnalyticsService;

  beforeEach(async () => {
    cache.clear();
    signalRepo.find.mockReset();
    tradeRepo.find.mockReset();
    earningRepo.find.mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProviderAnalyticsService,
        { provide: getRepositoryToken(Signal), useValue: signalRepo },
        { provide: getRepositoryToken(Trade), useValue: tradeRepo },
        { provide: getRepositoryToken(ProviderEarning), useValue: earningRepo },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: async <T>(key: string) => cache.get(key) as T | undefined,
            set: async (key: string, value: unknown) => {
              cache.set(key, value);
            },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(ProviderAnalyticsService);
  });

  it('returns empty response when provider has no signals', async () => {
    signalRepo.find.mockResolvedValue([]);
    tradeRepo.find.mockResolvedValue([]);
    earningRepo.find.mockResolvedValue([]);

    const result = await service.getAnalytics('provider-1');
    expect(result).toEqual({
      overview: {
        totalSignals: 0,
        totalCopiers: 0,
        totalRevenue: 0,
        avgCopiesPerSignal: 0,
      },
      performanceByAsset: [],
      revenueChart: [],
      topSignals: [],
    });
  });

  it('throws when only one date is provided', async () => {
    await expect(
      service.getAnalytics('provider-1', '2026-01-01'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
