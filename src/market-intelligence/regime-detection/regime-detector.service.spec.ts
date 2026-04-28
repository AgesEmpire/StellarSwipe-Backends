import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RegimeDetectorService } from './regime-detector.service';
import { MarketRegime, MarketRegimeType } from './entities/market-regime.entity';
import { RegimeTransition } from './entities/regime-transition.entity';
import { PriceOracleService } from '../../prices/price-oracle.service';

const mockMarketRegime = {
  id: 'reg-123',
  assetPair: 'XLM-USDC',
  type: MarketRegimeType.SIDEWAYS,
  confidence: 0.8,
  startTime: new Date(),
  endTime: null,
  metrics: { volatility: 0.01, trend: 0.001 },
};

describe('RegimeDetectorService', () => {
  let service: RegimeDetectorService;
  let regimeRepository: Repository<MarketRegime>;
  let priceOracleService: PriceOracleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegimeDetectorService,
        {
          provide: getRepositoryToken(MarketRegime),
          useValue: {
            create: jest.fn().mockImplementation((dto) => dto),
            save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'uuid', ...entity })),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(RegimeTransition),
          useValue: {
            create: jest.fn().mockImplementation((dto) => dto),
            save: jest.fn(),
          },
        },
        {
          provide: PriceOracleService,
          useValue: {
            getPriceHistory: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RegimeDetectorService>(RegimeDetectorService);
    regimeRepository = module.get<Repository<MarketRegime>>(getRepositoryToken(MarketRegime));
    priceOracleService = module.get<PriceOracleService>(PriceOracleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('detectRegime', () => {
    it('should classify a BULL regime correctly', async () => {
      // Mock historical prices with a steady upward trend and low volatility
      const mockHistory = Array.from({ length: 10 }, (_, i) => ({
        price: 100 + i * 2, // 100, 102, 104... (Bullish trend)
        timestamp: new Date(),
      }));
      (priceOracleService.getPriceHistory as jest.Mock).mockResolvedValue(mockHistory);
      jest.spyOn(regimeRepository, 'findOne').mockResolvedValue(null);

      const result = await service.detectRegime({ assetPair: 'XLM-USDC' });

      expect(result.type).toBe(MarketRegimeType.BULL);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should classify a BEAR regime correctly', async () => {
      // Mock historical prices with a downward trend
      const mockHistory = Array.from({ length: 10 }, (_, i) => ({
        price: 100 - i * 2, // 100, 98, 96... (Bearish trend)
        timestamp: new Date(),
      }));
      (priceOracleService.getPriceHistory as jest.Mock).mockResolvedValue(mockHistory);
      jest.spyOn(regimeRepository, 'findOne').mockResolvedValue(null);

      const result = await service.detectRegime({ assetPair: 'XLM-USDC' });

      expect(result.type).toBe(MarketRegimeType.BEAR);
    });

    it('should classify a VOLATILE regime correctly', async () => {
      // Mock historical prices with high volatility
      const mockHistory = [
        { price: 100 }, { price: 110 }, { price: 90 }, { price: 120 }, { price: 80 },
      ].map(p => ({ ...p, timestamp: new Date() }));
      (priceOracleService.getPriceHistory as jest.Mock).mockResolvedValue(mockHistory);
      jest.spyOn(regimeRepository, 'findOne').mockResolvedValue(null);

      const result = await service.detectRegime({ assetPair: 'XLM-USDC' });

      expect(result.type).toBe(MarketRegimeType.VOLATILE);
    });

    it('should return a fallback regime if insufficient data', async () => {
      (priceOracleService.getPriceHistory as jest.Mock).mockResolvedValue([]);
      
      const result = await service.detectRegime({ assetPair: 'XLM-USDC' });

      expect(result.type).toBe(MarketRegimeType.SIDEWAYS);
      expect(result.id).toBe('fallback');
    });

    it('should handle transitions when regime changes', async () => {
      const mockHistory = Array.from({ length: 10 }, (_, i) => ({
        price: 100 + i * 5, // Strong bull
        timestamp: new Date(),
      }));
      (priceOracleService.getPriceHistory as jest.Mock).mockResolvedValue(mockHistory);
      
      // Currently in SIDEWAYS
      jest.spyOn(regimeRepository, 'findOne').mockResolvedValue(mockMarketRegime as any);

      const result = await service.detectRegime({ assetPair: 'XLM-USDC' });

      expect(result.type).toBe(MarketRegimeType.BULL);
      expect(regimeRepository.save).toHaveBeenCalled(); // Should save the old regime with endTime and the new one
    });
  });
});
