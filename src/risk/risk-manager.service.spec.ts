import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RiskManagerService, TradeDetails } from './risk-manager.service';
import { RiskSettings } from './entities/risk-settings.entity';
import { BadRequestException } from '@nestjs/common';

describe('RiskManagerService', () => {
  let service: RiskManagerService;
  let mockRepository: any;

  const mockRiskSettings: RiskSettings = {
    id: '1',
    userId: 'user-1',
    maxOpenPositions: 10,
    maxExposurePercentage: 50,
    requireStopLoss: true,
    minStopLossPercentage: 5,
    maxStopLossPercentage: 20,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockRepository = {
      findOne: jest.fn().mockResolvedValue(mockRiskSettings),
      create: jest.fn().mockReturnValue(mockRiskSettings),
      save: jest.fn().mockResolvedValue(mockRiskSettings),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiskManagerService,
        {
          provide: getRepositoryToken(RiskSettings),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<RiskManagerService>(RiskManagerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateTrade', () => {
    const trade: TradeDetails = {
      userId: 'user-1',
      asset: 'XLM',
      amount: 100,
      entryPrice: 0.1,
      stopLossPrice: 0.09, // 10% SL
    };

    it('should validate a correct trade', async () => {
      const result = await service.validateTrade(trade, 5, 100, 1000);
      expect(result).toBe(true);
    });

    it('should throw error when max positions reached', async () => {
      await expect(service.validateTrade(trade, 10, 100, 1000))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw error when stop-loss is missing but required', async () => {
      const badTrade = { ...trade, stopLossPrice: undefined };
      await expect(service.validateTrade(badTrade, 5, 100, 1000))
        .rejects.toThrow('Stop-loss is required');
    });

    it('should throw error when stop-loss is out of range (too small)', async () => {
      const badTrade = { ...trade, stopLossPrice: 0.098 }; // 2% SL
      await expect(service.validateTrade(badTrade, 5, 100, 1000))
        .rejects.toThrow('Stop-loss must be between 5% and 20%');
    });

    it('should throw error when stop-loss is out of range (too large)', async () => {
      const badTrade = { ...trade, stopLossPrice: 0.07 }; // 30% SL
      await expect(service.validateTrade(badTrade, 5, 100, 1000))
        .rejects.toThrow('Stop-loss must be between 5% and 20%');
    });

    it('should throw error when exposure limit exceeded', async () => {
      // Balance 1000, 50% limit = 500 max exposure
      // Current exposure 450 + new trade 100*0.1=10 => 460 (OK)
      // Current exposure 500 + new trade 10*1=10 => 510 (FAIL)
      await expect(service.validateTrade(trade, 5, 500, 1000))
        .rejects.toThrow('Total exposure would exceed limit');
    });

    it('should throw error when potential loss exceeds balance', async () => {
      // Override settings for this test to allow high exposure
      mockRepository.findOne.mockResolvedValueOnce({
        ...mockRiskSettings,
        maxExposurePercentage: 1000,
      });

      const riskyTrade: TradeDetails = { 
        ...trade, 
        amount: 6000, 
        entryPrice: 1, 
        stopLossPrice: 0.8 // 20% SL (Valid), Loss = 1200
      }; 
      await expect(service.validateTrade(riskyTrade, 5, 0, 1000))
        .rejects.toThrow('Insufficient balance to cover potential loss');
    });
  });
});
