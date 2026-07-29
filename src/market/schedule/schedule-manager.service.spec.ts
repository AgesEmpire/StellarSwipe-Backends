import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ScheduleManagerService } from './schedule-manager.service';
import { MarketSchedule, DayOfWeek } from './entities/market-schedule.entity';

describe('ScheduleManagerService', () => {
  let service: ScheduleManagerService;
  let mockRepo: any;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduleManagerService,
        { provide: getRepositoryToken(MarketSchedule), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<ScheduleManagerService>(ScheduleManagerService);
  });

  describe('create', () => {
    it('should create a new market schedule', async () => {
      const dto = { region: 'US', assetClass: 'equity', dayOfWeek: DayOfWeek.MONDAY, openTime: '09:30', closeTime: '16:00' };
      const saved = { id: 's1', ...dto, timezone: 'UTC', isActive: true };
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);

      const result = await service.create(dto);
      expect(result.region).toBe('US');
      expect(result.openTime).toBe('09:30');
    });
  });

  describe('update', () => {
    it('should update existing schedule', async () => {
      const existing = { id: 's1', region: 'US', assetClass: 'equity', openTime: '09:00', closeTime: '16:00', isActive: true };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockResolvedValue({ ...existing, openTime: '09:30' });

      const result = await service.update('s1', { openTime: '09:30' });
      expect(result.openTime).toBe('09:30');
    });

    it('should throw NotFoundException for unknown schedule', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.update('bad-id', { isActive: false })).rejects.toThrow(NotFoundException);
    });
  });

  describe('validateMarketOpen', () => {
    it('should throw BadRequestException when market is closed', async () => {
      mockRepo.findOne.mockResolvedValue({
        region: 'US', assetClass: 'equity', openTime: '09:30', closeTime: '16:00', isActive: true,
      });

      jest.spyOn(service, 'getStatus').mockResolvedValue({
        isOpen: false, region: 'US', assetClass: 'equity', currentTime: '20:00', message: 'Market is closed',
      });

      await expect(service.validateMarketOpen('US', 'equity')).rejects.toThrow(BadRequestException);
    });
  });
});
