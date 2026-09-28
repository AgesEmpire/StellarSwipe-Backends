import { Test, TestingModule } from '@nestjs/testing';
import { MarketDataIngestionService, MarketDataPayload } from './market-data-ingestion.service';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MarketSnapshot } from './entities/market-snapshot.entity';
import { SdexPriceProvider } from '../prices/providers/sdex-price.provider';
import { CoinGeckoPriceProvider } from '../prices/providers/coingecko-price.provider';
import { PriceOracleService } from '../prices/price-oracle.service';

/**
 * #533 — Market Data Ingestion Service Tests
 *
 * Tests for market data ingestion pipeline including:
 * - Periodic ingestion of prices and liquidity
 * - Data normalization and storage
 * - Retry logic and failure handling
 * - Cache management
 * - Event emission for monitoring
 */
describe('MarketDataIngestionService (#533)', () => {
  let service: MarketDataIngestionService;
  let mockRepository: Repository<MarketSnapshot>;
  let mockCacheManager: Cache;
  let mockEventEmitter: EventEmitter2;
  let mockSdexProvider: SdexPriceProvider;
  let mockCoinGeckoProvider: CoinGeckoPriceProvider;
  let mockPriceOracle: PriceOracleService;

  beforeEach(async () => {
    mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
    } as any;

    mockCacheManager = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
    } as any;

    mockEventEmitter = {
      emit: jest.fn(),
    } as any;

    mockSdexProvider = {
      getPrice: jest.fn(),
    } as any;

    mockCoinGeckoProvider = {
      getPrice: jest.fn(),
    } as any;

    mockPriceOracle = {} as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketDataIngestionService,
        {
          provide: getRepositoryToken(MarketSnapshot),
          useValue: mockRepository,
        },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        {
          provide: SdexPriceProvider,
          useValue: mockSdexProvider,
        },
        {
          provide: CoinGeckoPriceProvider,
          useValue: mockCoinGeckoProvider,
        },
        {
          provide: PriceOracleService,
          useValue: mockPriceOracle,
        },
      ],
    }).compile();

    service = module.get<MarketDataIngestionService>(
      MarketDataIngestionService,
    );
  });

  describe('ingestMarketData (#533)', () => {
    it('should ingest market data from SDEX successfully', async () => {
      const mockData = {
        price: '50.25',
        liquidity: '1000.00',
        volume24h: '500000',
      };

      (mockSdexProvider.getPrice as jest.Mock).mockResolvedValue(mockData);
      (mockRepository.create as jest.Mock).mockReturnValue({});
      (mockRepository.save as jest.Mock).mockResolvedValue({});

      const result = await service.ingestMarketData('XLM/USD');

      expect(result).toBeDefined();
      expect(result?.assetPair).toBe('XLM/USD');
      expect(result?.price).toBe(50.25);
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should fallback to CoinGecko when SDEX fails', async () => {
      (mockSdexProvider.getPrice as jest.Mock).mockRejectedValue(
        new Error('SDEX error'),
      );

      const mockCoinGeckoData = {
        price: '50.20',
        volume24h: '450000',
      };

      (mockCoinGeckoProvider.getPrice as jest.Mock).mockResolvedValue(
        mockCoinGeckoData,
      );
      (mockRepository.save as jest.Mock).mockResolvedValue({});

      const result = await service.ingestMarketData('XLM/USD');

      expect(result).toBeDefined();
      expect(mockCoinGeckoProvider.getPrice).toHaveBeenCalled();
    });

    it('should retry on transient failures (#533)', async () => {
      let attempts = 0;
      (mockSdexProvider.getPrice as jest.Mock).mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve({
          price: '50.25',
          liquidity: '1000',
          volume24h: '500000',
        });
      });

      (mockRepository.save as jest.Mock).mockResolvedValue({});

      const result = await service.ingestMarketData('BTC/USD');

      expect(result).toBeDefined();
      expect(attempts).toBeGreaterThan(1);
    });

    it('should cache market data after successful ingestion', async () => {
      (mockSdexProvider.getPrice as jest.Mock).mockResolvedValue({
        price: '50.25',
        liquidity: '1000',
        volume24h: '500000',
      });
      (mockRepository.save as jest.Mock).mockResolvedValue({});

      await service.ingestMarketData('XLM/USD');

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'market:XLM/USD:snapshot',
        expect.any(Object),
        expect.any(Number),
      );
    });

    it('should emit event on successful ingestion', async () => {
      (mockSdexProvider.getPrice as jest.Mock).mockResolvedValue({
        price: '50.25',
        liquidity: '1000',
        volume24h: '500000',
      });
      (mockRepository.save as jest.Mock).mockResolvedValue({});

      await service.ingestMarketData('XLM/USD');

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'market.data.ingested',
        expect.objectContaining({
          assetPair: 'XLM/USD',
          price: 50.25,
        }),
      );
    });

    it('should emit failure event when all sources fail', async () => {
      (mockSdexProvider.getPrice as jest.Mock).mockRejectedValue(
        new Error('SDEX error'),
      );
      (mockCoinGeckoProvider.getPrice as jest.Mock).mockRejectedValue(
        new Error('CoinGecko error'),
      );

      const result = await service.ingestMarketData('UNKNOWN/ASSET');

      expect(result).toBeNull();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'market.ingestion.failed',
        expect.objectContaining({
          assetPair: 'UNKNOWN/ASSET',
        }),
      );
    });

    it('should prevent concurrent ingestion of same asset', async () => {
      let sdexCallCount = 0;
      (mockSdexProvider.getPrice as jest.Mock).mockImplementation(() => {
        sdexCallCount++;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              price: '50.25',
              liquidity: '1000',
              volume24h: '500000',
            });
          }, 100);
        });
      });
      (mockRepository.save as jest.Mock).mockResolvedValue({});

      // Start two concurrent ingestions
      const promise1 = service.ingestMarketData('XLM/USD');
      const promise2 = service.ingestMarketData('XLM/USD');

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Second attempt should be blocked and return null
      expect(result1).toBeDefined();
      expect(result2).toBeNull();
      expect(sdexCallCount).toBe(1); // Only called once
    });
  });

  describe('ingestAllMarketData (#533)', () => {
    it('should ingest data for all supported assets', async () => {
      const mockData = {
        price: '50.25',
        liquidity: '1000',
        volume24h: '500000',
      };

      (mockSdexProvider.getPrice as jest.Mock).mockResolvedValue(mockData);
      (mockRepository.save as jest.Mock).mockResolvedValue({});

      const results = await service.ingestAllMarketData();

      expect(results.size).toBeGreaterThan(0);
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should handle partial failures gracefully', async () => {
      let callCount = 0;
      (mockSdexProvider.getPrice as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 0) {
          return Promise.reject(new Error('API error'));
        }
        return Promise.resolve({
          price: '50.25',
          liquidity: '1000',
          volume24h: '500000',
        });
      });
      (mockCoinGeckoProvider.getPrice as jest.Mock).mockResolvedValue({
        price: '50.20',
        volume24h: '450000',
      });
      (mockRepository.save as jest.Mock).mockResolvedValue({});

      const results = await service.ingestAllMarketData();

      expect(results.size).toBeGreaterThan(0);
      const successes = Array.from(results.values()).filter((v) => v !== null);
      expect(successes.length).toBeGreaterThan(0);
    });

    it('should emit completion event with metrics', async () => {
      (mockSdexProvider.getPrice as jest.Mock).mockResolvedValue({
        price: '50.25',
        liquidity: '1000',
        volume24h: '500000',
      });
      (mockRepository.save as jest.Mock).mockResolvedValue({});

      await service.ingestAllMarketData();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'market.ingestion.completed',
        expect.objectContaining({
          totalAssets: expect.any(Number),
          successCount: expect.any(Number),
          duration: expect.any(Number),
        }),
      );
    });

    it('should respect concurrency limits during bulk ingestion', async () => {
      const maxConcurrent = 3; // Default concurrency limit
      let maxSimultaneous = 0;
      let currentCount = 0;

      (mockSdexProvider.getPrice as jest.Mock).mockImplementation(() => {
        currentCount++;
        maxSimultaneous = Math.max(maxSimultaneous, currentCount);
        return new Promise((resolve) => {
          setTimeout(() => {
            currentCount--;
            resolve({
              price: '50.25',
              liquidity: '1000',
              volume24h: '500000',
            });
          }, 10);
        });
      });
      (mockRepository.save as jest.Mock).mockResolvedValue({});

      await service.ingestAllMarketData();

      expect(maxSimultaneous).toBeLessThanOrEqual(maxConcurrent);
    });
  });

  describe('Data storage and caching (#533)', () => {
    it('should store market snapshot in database', async () => {
      (mockSdexProvider.getPrice as jest.Mock).mockResolvedValue({
        price: '50.25',
        liquidity: '1000',
        volume24h: '500000',
      });
      (mockRepository.create as jest.Mock).mockReturnValue({});
      (mockRepository.save as jest.Mock).mockResolvedValue({});

      await service.ingestMarketData('XLM/USD');

      expect(mockRepository.create).toHaveBeenCalled();
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should normalize data for feed and execution use', async () => {
      const rawData = {
        price: '50.25123456',
        liquidity: '1000.987654',
        volume24h: '500000.123',
      };

      (mockSdexProvider.getPrice as jest.Mock).mockResolvedValue(rawData);
      (mockRepository.save as jest.Mock).mockResolvedValue({});

      const result = await service.ingestMarketData('XLM/USD');

      expect(result?.price).toBe(50.25123456);
      expect(result?.liquidity).toBe(1000.987654);
    });

    it('should retrieve latest snapshot from cache', async () => {
      const mockSnapshot = {
        assetPair: 'XLM/USD',
        price: 50.25,
        liquidity: 1000,
        volume24h: 500000,
        timestamp: new Date(),
      };

      (mockCacheManager.get as jest.Mock).mockResolvedValue(mockSnapshot);

      const result = await service.getLatestSnapshot('XLM/USD');

      expect(result).toEqual(mockSnapshot);
      expect(mockCacheManager.get).toHaveBeenCalledWith(
        'market:XLM/USD:snapshot',
      );
    });

    it('should fallback to database when cache miss', async () => {
      (mockCacheManager.get as jest.Mock).mockResolvedValue(null);
      (mockRepository.findOne as jest.Mock).mockResolvedValue({
        assetPair: 'XLM/USD',
        baseAsset: 'XLM',
        counterAsset: 'USD',
        price: '50.25',
        liquidity: '1000',
        volume24h: '500000',
        capturedAt: new Date(),
      });

      const result = await service.getLatestSnapshot('XLM/USD');

      expect(result).toBeDefined();
      expect(mockRepository.findOne).toHaveBeenCalled();
    });
  });

  describe('Error handling and resilience (#533)', () => {
    it('should not block backend on ingestion failure', async () => {
      (mockSdexProvider.getPrice as jest.Mock).mockRejectedValue(
        new Error('API error'),
      );
      (mockCoinGeckoProvider.getPrice as jest.Mock).mockRejectedValue(
        new Error('API error'),
      );

      const result = await service.ingestMarketData('XLM/USD');

      expect(result).toBeNull();
      // Should not throw
    });

    it('should log failures without crashing', async () => {
      (mockSdexProvider.getPrice as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );
      (mockCoinGeckoProvider.getPrice as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      const result = await service.ingestMarketData('INVALID/PAIR');

      expect(result).toBeNull();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
      );
    });

    it('should continue ingestion if database save fails', async () => {
      (mockSdexProvider.getPrice as jest.Mock).mockResolvedValue({
        price: '50.25',
        liquidity: '1000',
        volume24h: '500000',
      });
      (mockRepository.create as jest.Mock).mockReturnValue({});
      (mockRepository.save as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.ingestMarketData('XLM/USD');

      // Should still return data even if storage fails
      expect(result).toBeDefined();
      expect(mockCacheManager.set).toHaveBeenCalled();
    });
  });

  describe('Asset management (#533)', () => {
    it('should return list of supported assets', () => {
      const assets = service.getSupportedAssets();

      expect(Array.isArray(assets)).toBe(true);
      expect(assets.length).toBeGreaterThan(0);
      expect(assets).toContain('XLM/USD');
    });

    it('should allow adding new assets at runtime', () => {
      const newAsset = 'CUSTOM/TOKEN';
      service.addSupportedAsset(newAsset);

      const assets = service.getSupportedAssets();
      expect(assets).toContain(newAsset);
    });

    it('should not add duplicate assets', () => {
      const asset = 'XLM/USD';
      const initialCount = service.getSupportedAssets().length;

      service.addSupportedAsset(asset);
      service.addSupportedAsset(asset);

      expect(service.getSupportedAssets().length).toBe(initialCount);
    });
  });

  describe('Monitoring metrics (#533)', () => {
    it('should report ingestion metrics', () => {
      const metrics = service.getIngestionMetrics();

      expect(metrics).toHaveProperty('supportedAssets');
      expect(metrics).toHaveProperty('currentlyIngesting');
      expect(metrics.supportedAssets).toBeGreaterThan(0);
      expect(metrics.currentlyIngesting).toBeGreaterThanOrEqual(0);
    });
  });
});
