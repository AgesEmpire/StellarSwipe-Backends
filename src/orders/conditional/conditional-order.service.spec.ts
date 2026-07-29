import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConditionalOrderService, PriceSnapshot } from './conditional-order.service';
import { ConditionalOrder } from './conditional-order.entity';
import {
  CreateConditionalOrderDto,
  ConditionalOrderStatus,
  ConditionalOrderSide,
} from './dto/create-conditional-order.dto';
import {
  ConditionType,
  ConditionOperator,
} from './dto/order-condition.dto';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('ConditionalOrderService', () => {
  let service: ConditionalOrderService;
  let repo: jest.Mocked<Repository<ConditionalOrder>>;

  const mockOrder = {
    id: 'order-1',
    userId: 'user-1',
    side: ConditionalOrderSide.BUY,
    sellingAssetCode: 'XLM',
    buyingAssetCode: 'USDC',
    amount: 100,
    limitPrice: 0.5,
    slippageTolerance: 1,
    conditions: [
      {
        conditions: [
          { type: ConditionType.PRICE_BELOW, value: 0.45, assetCode: 'XLM' },
        ],
        operator: ConditionOperator.AND,
      },
    ],
    status: ConditionalOrderStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ConditionalOrder;

  beforeEach(async () => {
    const mockRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConditionalOrderService,
        { provide: getRepositoryToken(ConditionalOrder), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<ConditionalOrderService>(ConditionalOrderService);
    repo = module.get(getRepositoryToken(ConditionalOrder));
  });

  describe('create', () => {
    it('should create a conditional order', async () => {
      const dto: CreateConditionalOrderDto = {
        userId: 'user-1',
        side: ConditionalOrderSide.BUY,
        sellingAssetCode: 'XLM',
        buyingAssetCode: 'USDC',
        amount: 100,
        limitPrice: 0.5,
        conditionGroups: [
          {
            conditions: [
              { type: ConditionType.PRICE_BELOW, value: 0.45, assetCode: 'XLM' },
            ],
            operator: ConditionOperator.AND,
          },
        ],
      };
      repo.create.mockReturnValue(mockOrder);
      repo.save.mockResolvedValue(mockOrder);
      const result = await service.create(dto);
      expect(repo.create).toHaveBeenCalled();
      expect(result).toEqual(mockOrder);
    });

    it('should reject creation without condition groups', async () => {
      const dto: CreateConditionalOrderDto = {
        userId: 'user-1',
        side: ConditionalOrderSide.BUY,
        sellingAssetCode: 'XLM',
        buyingAssetCode: 'USDC',
        amount: 100,
        conditionGroups: [],
      };
      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('should find an order by id', async () => {
      repo.findOne.mockResolvedValue(mockOrder);
      const result = await service.findById('order-1');
      expect(result).toEqual(mockOrder);
    });

    it('should throw when order not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByUser', () => {
    it('should return orders for a user', async () => {
      repo.find.mockResolvedValue([mockOrder]);
      const result = await service.findByUser('user-1');
      expect(result).toHaveLength(1);
    });

    it('should filter by status', async () => {
      repo.find.mockResolvedValue([mockOrder]);
      await service.findByUser('user-1', ConditionalOrderStatus.PENDING);
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', status: ConditionalOrderStatus.PENDING },
        }),
      );
    });
  });

  describe('cancel', () => {
    it('should cancel an active order', async () => {
      repo.findOne.mockResolvedValue({ ...mockOrder, status: ConditionalOrderStatus.ACTIVE });
      repo.save.mockImplementation(async (o) => o);
      const result = await service.cancel('order-1');
      expect(result.status).toBe(ConditionalOrderStatus.CANCELLED);
      expect(result.cancelledAt).toBeDefined();
    });

    it('should reject cancelling a filled order', async () => {
      repo.findOne.mockResolvedValue({ ...mockOrder, status: ConditionalOrderStatus.FILLED });
      await expect(service.cancel('order-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('evaluateConditions', () => {
    it('should trigger orders when conditions are met', async () => {
      const order = {
        ...mockOrder,
        conditions: [
          {
            conditions: [
              { type: ConditionType.PRICE_ABOVE, value: 100, assetCode: 'BTC' },
            ],
            operator: ConditionOperator.AND,
          },
        ],
      };
      repo.find.mockResolvedValue([order]);
      repo.save.mockImplementation(async (o) => o);
      const snapshots = new Map<string, PriceSnapshot>();
      snapshots.set('BTC:native', { assetCode: 'BTC', price: 150, timestamp: new Date() });
      const result = await service.evaluateConditions(snapshots);
      expect(result.evaluated).toBe(1);
      expect(result.triggered).toHaveLength(1);
    });

    it('should not trigger when conditions are not met', async () => {
      const order = {
        ...mockOrder,
        conditions: [
          {
            conditions: [
              { type: ConditionType.PRICE_ABOVE, value: 200, assetCode: 'BTC' },
            ],
            operator: ConditionOperator.AND,
          },
        ],
      };
      repo.find.mockResolvedValue([order]);
      const snapshots = new Map<string, PriceSnapshot>();
      snapshots.set('BTC:native', { assetCode: 'BTC', price: 150, timestamp: new Date() });
      const result = await service.evaluateConditions(snapshots);
      expect(result.evaluated).toBe(1);
      expect(result.triggered).toHaveLength(0);
    });
  });

  describe('executeTriggeredOrder', () => {
    it('should execute a triggered order', async () => {
      repo.findOne.mockResolvedValue({ ...mockOrder, status: ConditionalOrderStatus.TRIGGERED });
      repo.save.mockImplementation(async (o) => o);
      const result = await service.executeTriggeredOrder('order-1', 'trade-1');
      expect(result.status).toBe(ConditionalOrderStatus.FILLED);
      expect(result.resultingTradeId).toBe('trade-1');
    });

    it('should reject executing non-triggered order', async () => {
      repo.findOne.mockResolvedValue({ ...mockOrder, status: ConditionalOrderStatus.PENDING });
      await expect(service.executeTriggeredOrder('order-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('expireStaleOrders', () => {
    it('should mark expired orders', async () => {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      };
      repo.createQueryBuilder.mockReturnValue(qb);
      expect(await service.expireStaleOrders()).toBe(2);
    });
  });

  describe('update', () => {
    it('should update a pending order', async () => {
      repo.findOne.mockResolvedValue({ ...mockOrder, status: ConditionalOrderStatus.PENDING });
      repo.save.mockImplementation(async (o) => o);
      const result = await service.update('order-1', { amount: 200 } as any);
      expect(result.amount).toBe(200);
    });

    it('should reject updating a filled order', async () => {
      repo.findOne.mockResolvedValue({ ...mockOrder, status: ConditionalOrderStatus.FILLED });
      await expect(service.update('order-1', { amount: 200 } as any)).rejects.toThrow(BadRequestException);
    });
  });
});
