import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { SocialExportService } from './social-export.service';
import { Trade, TradeStatus, TradeSide } from '../trades/entities/trade.entity';
import { Signal } from '../signals/entities/signal.entity';
import { SocialPlatform } from './social-export.dto';

const mockTrade = (overrides: Partial<Trade> = {}): Trade =>
  ({
    id: 'trade-1',
    userId: 'user-1',
    signalId: 'signal-1',
    baseAsset: 'XLM',
    counterAsset: 'USDC',
    side: TradeSide.BUY,
    entryPrice: '0.12',
    exitPrice: '0.15',
    profitLossPercentage: '25.00',
    status: TradeStatus.COMPLETED,
    ...overrides,
  } as Trade);

const mockSignal = (): Partial<Signal> => ({
  id: 'signal-1',
  provider: { username: 'traderJoe' } as any,
});

describe('SocialExportService', () => {
  let service: SocialExportService;
  let tradeRepo: { findOne: jest.Mock };
  let signalRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    tradeRepo = { findOne: jest.fn() };
    signalRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialExportService,
        { provide: getRepositoryToken(Trade), useValue: tradeRepo },
        { provide: getRepositoryToken(Signal), useValue: signalRepo },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('https://stellarswipe.io') },
        },
      ],
    }).compile();

    service = module.get(SocialExportService);
  });

  it('should generate a valid export payload for a profitable trade', async () => {
    tradeRepo.findOne.mockResolvedValue(mockTrade());
    signalRepo.findOne.mockResolvedValue(mockSignal());

    const result = await service.generateExport('trade-1', {
      tradeId: 'trade-1',
      platform: SocialPlatform.TWITTER,
    });

    expect(result.pair).toBe('XLM/USDC');
    expect(result.pnlPercent).toBe('25.00');
    expect(result.pnlDirection).toBe('profit');
    expect(result.headline).toContain('+25.00%');
    expect(result.headline).toContain('🚀');
    expect(result.providerHandle).toBe('@traderJoe');
    expect(result.platform).toBe(SocialPlatform.TWITTER);
    expect(result.generatedAt).toBeDefined();
  });

  it('should generate a loss payload with correct direction and emoji', async () => {
    tradeRepo.findOne.mockResolvedValue(mockTrade({ profitLossPercentage: '-8.50' }));
    signalRepo.findOne.mockResolvedValue(mockSignal());

    const result = await service.generateExport('trade-1', { tradeId: 'trade-1' });

    expect(result.pnlDirection).toBe('loss');
    expect(result.headline).toContain('📉');
  });

  it('should not expose userId or wallet address in the payload', async () => {
    tradeRepo.findOne.mockResolvedValue(mockTrade());
    signalRepo.findOne.mockResolvedValue(mockSignal());

    const result = await service.generateExport('trade-1', { tradeId: 'trade-1' });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('user-1');
    expect(serialized).not.toContain('walletAddress');
    expect(serialized).not.toContain('email');
  });

  it('should include Twitter hashtags for twitter platform', async () => {
    tradeRepo.findOne.mockResolvedValue(mockTrade());
    signalRepo.findOne.mockResolvedValue(mockSignal());

    const result = await service.generateExport('trade-1', {
      tradeId: 'trade-1',
      platform: SocialPlatform.TWITTER,
    });

    expect(result.shareText).toContain('#StellarSwipe');
    expect(result.shareText).toContain('#DeFi');
  });

  it('should not include hashtags for generic platform', async () => {
    tradeRepo.findOne.mockResolvedValue(mockTrade());
    signalRepo.findOne.mockResolvedValue(mockSignal());

    const result = await service.generateExport('trade-1', {
      tradeId: 'trade-1',
      platform: SocialPlatform.GENERIC,
    });

    expect(result.shareText).not.toContain('#StellarSwipe');
  });

  it('should fall back to @StellarSwipe when provider username is missing', async () => {
    tradeRepo.findOne.mockResolvedValue(mockTrade());
    signalRepo.findOne.mockResolvedValue({ id: 'signal-1', provider: {} });

    const result = await service.generateExport('trade-1', { tradeId: 'trade-1' });
    expect(result.providerHandle).toBe('@StellarSwipe');
  });

  it('should throw NotFoundException when trade does not exist', async () => {
    tradeRepo.findOne.mockResolvedValue(null);

    await expect(
      service.generateExport('ghost-trade', { tradeId: 'ghost-trade' }),
    ).rejects.toThrow(NotFoundException);
  });
});
