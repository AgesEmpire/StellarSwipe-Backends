import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ScheduledTradesService } from './scheduled-trades.service';
import { ScheduledTrade, ScheduleType, ScheduleStatus, PriceConditionType, RecurrenceType } from './entities/scheduled-trade.entity';
import { PriceConditionEvaluator } from './conditions/price-condition.evaluator';
import { TimeConditionEvaluator } from './conditions/time-condition.evaluator';
import { DataSource } from 'typeorm';
import { CreateScheduleDto } from './dto/create-schedule.dto';

describe('ScheduledTradesService', () => {
  let service: ScheduledTradesService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let dataSource: { query: jest.Mock };
  let priceEvaluator: jest.Mocked<PriceConditionEvaluator>;
  let timeEvaluator: jest.Mocked<TimeConditionEvaluator>;

  const mockTrade: ScheduledTrade = {
    id: 'trade-uuid-1',
    userId: 'user-uuid-1',
    assetPair: 'XLM/USDC',
    scheduleType: ScheduleType.TIME,
    conditions: { executeAt: new Date('2026-01-20T14:00:00Z') },
    amount: 1000,
    status: ScheduleStatus.PENDING,
    retryCount: 0,
    maxRetries: 3,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    dataSource = { query: jest.fn() };

    const mockPriceEvaluator = { evaluate: jest.fn() };
    const mockTimeEvaluator = {
      isTimeReached: jest.fn(),
      isRecurrenceTime: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduledTradesService,
        { provide: getRepositoryToken(ScheduledTrade), useValue: repository },
        { provide: DataSource, useValue: dataSource },
        { provide: PriceConditionEvaluator, useValue: mockPriceEvaluator },
        { provide: TimeConditionEvaluator, useValue: mockTimeEvaluator },
      ],
    }).compile();

    service = module.get<ScheduledTradesService>(ScheduledTradesService);
    priceEvaluator = module.get(PriceConditionEvaluator);
    timeEvaluator = module.get(TimeConditionEvaluator);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('should create and save a scheduled trade', async () => {
      const dto: CreateScheduleDto = {
        userId: 'user-1',
        assetPair: 'XLM/USDC',
        scheduleType: ScheduleType.TIME,
        conditions: { executeAt: new Date() },
        amount: 100,
      };
      repository.create.mockReturnValue(mockTrade);
      repository.save.mockResolvedValue(mockTrade);

      const result = await service.create(dto);

      expect(repository.create).toHaveBeenCalledWith(dto);
      expect(repository.save).toHaveBeenCalledWith(mockTrade);
      expect(result).toBe(mockTrade);
    });
  });

  describe('findAll', () => {
    it('should return all trades for a user', async () => {
      repository.find.mockResolvedValue([mockTrade]);

      const result = await service.findAll('user-uuid-1');

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
      });
      expect(result).toEqual([mockTrade]);
    });
  });

  describe('findOne', () => {
    it('should return a trade by id', async () => {
      repository.findOne.mockResolvedValue(mockTrade);

      const result = await service.findOne('trade-uuid-1');

      expect(result).toBe(mockTrade);
    });

    it('should throw NotFoundException when trade not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cancel', () => {
    it('should cancel a pending trade', async () => {
      repository.findOne.mockResolvedValue({ ...mockTrade });
      repository.save.mockResolvedValue({
        ...mockTrade,
        status: ScheduleStatus.CANCELLED,
      });

      const result = await service.cancel('trade-uuid-1', 'user-uuid-1');

      expect(result.status).toBe(ScheduleStatus.CANCELLED);
    });

    it('should throw ForbiddenException when userId does not match', async () => {
      repository.findOne.mockResolvedValue({ ...mockTrade });

      await expect(
        service.cancel('trade-uuid-1', 'other-user'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when trade is not pending', async () => {
      repository.findOne.mockResolvedValue({
        ...mockTrade,
        status: ScheduleStatus.EXECUTED,
      });

      await expect(
        service.cancel('trade-uuid-1', 'user-uuid-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findPending', () => {
    it('should return all pending trades', async () => {
      repository.find.mockResolvedValue([mockTrade]);

      const result = await service.findPending();

      expect(repository.find).toHaveBeenCalledWith({
        where: { status: ScheduleStatus.PENDING },
      });
      expect(result).toEqual([mockTrade]);
    });
  });

  describe('getCurrentPrice', () => {
    it('should return parsed price when rows are returned', async () => {
      dataSource.query.mockResolvedValue([{ price: '0.09500' }]);

      const result = await service.getCurrentPrice('XLM/USDC');

      expect(result).toBeCloseTo(0.095, 5);
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('price_history'),
        ['XLM/USDC'],
      );
    });

    it('should return null when no rows returned', async () => {
      dataSource.query.mockResolvedValue([]);

      const result = await service.getCurrentPrice('XLM/USDC');

      expect(result).toBeNull();
    });
  });

  describe('updateScheduleStatus', () => {
    it('should call repository.update with id and status', async () => {
      repository.update.mockResolvedValue(undefined);

      await service.updateScheduleStatus('trade-uuid-1', ScheduleStatus.EXPIRED);

      expect(repository.update).toHaveBeenCalledWith('trade-uuid-1', {
        status: ScheduleStatus.EXPIRED,
      });
    });
  });

  describe('executeTrade', () => {
    it('should update with EXECUTED status for non-recurring trade', async () => {
      repository.update.mockResolvedValue(undefined);

      await service.executeTrade({ ...mockTrade, scheduleType: ScheduleType.TIME });

      expect(repository.update).toHaveBeenCalledWith(
        mockTrade.id,
        expect.objectContaining({ status: ScheduleStatus.EXECUTED }),
      );
    });

    it('should update only executedAt for recurring trade', async () => {
      repository.update.mockResolvedValue(undefined);

      await service.executeTrade({
        ...mockTrade,
        scheduleType: ScheduleType.RECURRING,
      });

      const [, updateData] = repository.update.mock.calls[0];
      expect(updateData).not.toHaveProperty('status');
      expect(updateData).toHaveProperty('executedAt');
    });

    it('should update retryCount and lastError when execution fails (retry < max)', async () => {
      repository.update.mockRejectedValueOnce(new Error('DB failure'));
      repository.update.mockResolvedValue(undefined);

      await service.executeTrade({ ...mockTrade, retryCount: 0, maxRetries: 3 });

      expect(repository.update).toHaveBeenCalledWith(
        mockTrade.id,
        expect.objectContaining({
          retryCount: 1,
          lastError: 'DB failure',
        }),
      );
    });

    it('should expire trade when retry count reaches maxRetries', async () => {
      repository.update.mockRejectedValueOnce(new Error('DB failure'));
      repository.update.mockResolvedValue(undefined);

      await service.executeTrade({ ...mockTrade, retryCount: 2, maxRetries: 3 });

      expect(repository.update).toHaveBeenCalledWith(
        mockTrade.id,
        expect.objectContaining({
          status: ScheduleStatus.EXPIRED,
          retryCount: 3,
          lastError: 'DB failure',
        }),
      );
    });
  });

  describe('evaluateScheduledTrades', () => {
    it('should expire schedule past its expiresAt date', async () => {
      const expired = {
        ...mockTrade,
        expiresAt: new Date('2020-01-01'),
      };
      repository.find.mockResolvedValue([expired]);
      repository.update.mockResolvedValue(undefined);

      await service.evaluateScheduledTrades();

      expect(repository.update).toHaveBeenCalledWith(expired.id, {
        status: ScheduleStatus.EXPIRED,
      });
    });

    it('should not expire schedule with future expiresAt', async () => {
      const notExpired = {
        ...mockTrade,
        expiresAt: new Date(Date.now() + 86400000),
        conditions: { executeAt: new Date('2020-01-01') },
      };
      repository.find.mockResolvedValue([notExpired]);
      repository.update.mockResolvedValue(undefined);
      timeEvaluator.isTimeReached.mockReturnValue(true);

      await service.evaluateScheduledTrades();

      // Should execute (time reached), not expire
      expect(repository.update).toHaveBeenCalledWith(
        notExpired.id,
        expect.objectContaining({ status: ScheduleStatus.EXECUTED }),
      );
    });

    it('should execute TIME schedule when time is reached', async () => {
      const schedule = {
        ...mockTrade,
        scheduleType: ScheduleType.TIME,
        conditions: { executeAt: new Date('2020-01-01') },
      };
      repository.find.mockResolvedValue([schedule]);
      repository.update.mockResolvedValue(undefined);
      timeEvaluator.isTimeReached.mockReturnValue(true);

      await service.evaluateScheduledTrades();

      expect(timeEvaluator.isTimeReached).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        schedule.id,
        expect.objectContaining({ status: ScheduleStatus.EXECUTED }),
      );
    });

    it('should not execute TIME schedule when time is not reached', async () => {
      const schedule = {
        ...mockTrade,
        scheduleType: ScheduleType.TIME,
        conditions: { executeAt: new Date(Date.now() + 86400000) },
      };
      repository.find.mockResolvedValue([schedule]);
      timeEvaluator.isTimeReached.mockReturnValue(false);

      await service.evaluateScheduledTrades();

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should not execute TIME schedule when executeAt is missing', async () => {
      const schedule = {
        ...mockTrade,
        scheduleType: ScheduleType.TIME,
        conditions: {},
      };
      repository.find.mockResolvedValue([schedule]);

      await service.evaluateScheduledTrades();

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should execute PRICE schedule when condition is met', async () => {
      const schedule = {
        ...mockTrade,
        scheduleType: ScheduleType.PRICE,
        conditions: {
          targetPrice: 0.09,
          priceCondition: PriceConditionType.BELOW,
        },
      };
      repository.find.mockResolvedValue([schedule]);
      repository.update.mockResolvedValue(undefined);
      dataSource.query.mockResolvedValue([{ price: '0.085' }]);
      priceEvaluator.evaluate.mockReturnValue(true);

      await service.evaluateScheduledTrades();

      expect(priceEvaluator.evaluate).toHaveBeenCalledWith(
        0.085,
        0.09,
        PriceConditionType.BELOW,
      );
      expect(repository.update).toHaveBeenCalledWith(
        schedule.id,
        expect.objectContaining({ status: ScheduleStatus.EXECUTED }),
      );
    });

    it('should not execute PRICE schedule when condition is not met', async () => {
      const schedule = {
        ...mockTrade,
        scheduleType: ScheduleType.PRICE,
        conditions: {
          targetPrice: 0.09,
          priceCondition: PriceConditionType.ABOVE,
        },
      };
      repository.find.mockResolvedValue([schedule]);
      dataSource.query.mockResolvedValue([{ price: '0.085' }]);
      priceEvaluator.evaluate.mockReturnValue(false);

      await service.evaluateScheduledTrades();

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should not execute PRICE schedule when price is unavailable', async () => {
      const schedule = {
        ...mockTrade,
        scheduleType: ScheduleType.PRICE,
        conditions: {
          targetPrice: 0.09,
          priceCondition: PriceConditionType.BELOW,
        },
      };
      repository.find.mockResolvedValue([schedule]);
      dataSource.query.mockResolvedValue([]);

      await service.evaluateScheduledTrades();

      expect(priceEvaluator.evaluate).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should execute RECURRING schedule when recurrence time is met', async () => {
      const schedule = {
        ...mockTrade,
        scheduleType: ScheduleType.RECURRING,
        conditions: {
          recurrence: RecurrenceType.DAILY,
          recurTime: '09:00',
        },
      };
      repository.find.mockResolvedValue([schedule]);
      repository.update.mockResolvedValue(undefined);
      timeEvaluator.isRecurrenceTime.mockReturnValue(true);

      await service.evaluateScheduledTrades();

      expect(timeEvaluator.isRecurrenceTime).toHaveBeenCalledWith(
        '09:00',
        RecurrenceType.DAILY,
        undefined,
      );
      // Recurring: no status change, only executedAt
      const [, updateData] = repository.update.mock.calls[0];
      expect(updateData).not.toHaveProperty('status');
      expect(updateData).toHaveProperty('executedAt');
    });

    it('should not execute RECURRING schedule when recurrence time is not met', async () => {
      const schedule = {
        ...mockTrade,
        scheduleType: ScheduleType.RECURRING,
        conditions: {
          recurrence: RecurrenceType.DAILY,
          recurTime: '09:00',
        },
      };
      repository.find.mockResolvedValue([schedule]);
      timeEvaluator.isRecurrenceTime.mockReturnValue(false);

      await service.evaluateScheduledTrades();

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should not execute RECURRING schedule when conditions are incomplete', async () => {
      const schedule = {
        ...mockTrade,
        scheduleType: ScheduleType.RECURRING,
        conditions: {},
      };
      repository.find.mockResolvedValue([schedule]);

      await service.evaluateScheduledTrades();

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should handle empty pending list without errors', async () => {
      repository.find.mockResolvedValue([]);

      await expect(service.evaluateScheduledTrades()).resolves.not.toThrow();
    });
  });
});
