import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MarketOrderController } from './market-order.controller';
import { MarketOrderService } from './services/market-order.service';
import { MarketOrderDto } from './dto/market-order.dto';
import { OrderType } from './dto/order-type.enum';

// A valid Stellar testnet keypair (public only — no real funds)
const SELLING_SECRET = 'SCZANGBA5AKIA7GV7JKBHKFRTZR7KKRMPYB3Y7Q3AZT6WRMICPX7NN5';

const baseDto: MarketOrderDto = {
  sourceSecret: SELLING_SECRET,
  sellingAssetCode: 'XLM',
  sellingAssetIssuer: undefined,
  buyingAssetCode: 'USDC',
  buyingAssetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  amount: 100,
  maxSlippagePercent: 1,
  orderType: OrderType.MARKET,
};

const fillResult = {
  hash: 'abc123',
  orderType: 'market' as const,
  status: 'filled' as const,
  priceEstimate: { averagePrice: 0.11, bestPrice: 0.10 },
  slippagePercent: 0.5,
  filledAmount: 100,
  timestamp: new Date(),
};

describe('MarketOrderController', () => {
  let controller: MarketOrderController;
  let mockService: { executeOrder: jest.Mock };

  beforeEach(async () => {
    mockService = { executeOrder: jest.fn().mockResolvedValue(fillResult) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MarketOrderController],
      providers: [{ provide: MarketOrderService, useValue: mockService }],
    }).compile();

    controller = module.get<MarketOrderController>(MarketOrderController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('executeMarketOrder — happy path', () => {
    it('calls MarketOrderService.executeOrder with the DTO', async () => {
      const result = await controller.executeMarketOrder(baseDto);
      expect(mockService.executeOrder).toHaveBeenCalledWith(baseDto);
      expect(result).toBe(fillResult);
    });

    it('returns fill details with hash, executedPrice, and size', async () => {
      const result = await controller.executeMarketOrder(baseDto);
      expect(result.hash).toBe('abc123');
      expect(result.filledAmount).toBe(100);
      expect(result.status).toBe('filled');
    });
  });

  describe('self-trade guard', () => {
    it('rejects order when buying and selling the same asset (same code, same issuer)', async () => {
      const selfTradeDto: MarketOrderDto = {
        ...baseDto,
        buyingAssetCode: 'XLM',
        buyingAssetIssuer: undefined,
      };
      await expect(controller.executeMarketOrder(selfTradeDto)).rejects.toThrow(BadRequestException);
      expect(mockService.executeOrder).not.toHaveBeenCalled();
    });

    it('allows orders where buying and selling are different assets', async () => {
      await expect(controller.executeMarketOrder(baseDto)).resolves.toBeDefined();
    });
  });

  describe('low liquidity failure', () => {
    it('propagates service errors to the caller', async () => {
      mockService.executeOrder.mockRejectedValue(
        Object.assign(new Error('Insufficient liquidity'), { status: 422, code: 'LOW_LIQUIDITY' }),
      );
      await expect(controller.executeMarketOrder(baseDto)).rejects.toThrow('Insufficient liquidity');
    });
  });
});
