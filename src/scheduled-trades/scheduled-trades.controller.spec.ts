import { Test, TestingModule } from '@nestjs/testing';
import { ScheduledTradesController } from './scheduled-trades.controller';
import { ScheduledTradesService } from './scheduled-trades.service';
import {
  ScheduledTrade,
  ScheduleType,
  ScheduleStatus,
} from './entities/scheduled-trade.entity';
import { CreateScheduleDto } from './dto/create-schedule.dto';

describe('ScheduledTradesController', () => {
  let controller: ScheduledTradesController;
  let service: jest.Mocked<ScheduledTradesService>;

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
    const mockService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      cancel: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScheduledTradesController],
      providers: [
        { provide: ScheduledTradesService, useValue: mockService },
      ],
    }).compile();

    controller = module.get<ScheduledTradesController>(ScheduledTradesController);
    service = module.get(ScheduledTradesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('should call service.create and return result', async () => {
      const dto: CreateScheduleDto = {
        userId: 'user-uuid-1',
        assetPair: 'XLM/USDC',
        scheduleType: ScheduleType.TIME,
        conditions: { executeAt: new Date() },
        amount: 1000,
      };
      service.create.mockResolvedValue(mockTrade);

      const result = await controller.create(dto);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toBe(mockTrade);
    });
  });

  describe('findAll', () => {
    it('should call service.findAll and return result', async () => {
      service.findAll.mockResolvedValue([mockTrade]);

      const result = await controller.findAll('user-uuid-1');

      expect(service.findAll).toHaveBeenCalledWith('user-uuid-1');
      expect(result).toEqual([mockTrade]);
    });
  });

  describe('findOne', () => {
    it('should call service.findOne and return result', async () => {
      service.findOne.mockResolvedValue(mockTrade);

      const result = await controller.findOne('trade-uuid-1');

      expect(service.findOne).toHaveBeenCalledWith('trade-uuid-1');
      expect(result).toBe(mockTrade);
    });
  });

  describe('cancel', () => {
    it('should call service.cancel and return result', async () => {
      const cancelled = { ...mockTrade, status: ScheduleStatus.CANCELLED };
      service.cancel.mockResolvedValue(cancelled as ScheduledTrade);

      const result = await controller.cancel('trade-uuid-1', 'user-uuid-1');

      expect(service.cancel).toHaveBeenCalledWith('trade-uuid-1', 'user-uuid-1');
      expect(result.status).toBe(ScheduleStatus.CANCELLED);
    });
  });
});
