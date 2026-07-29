import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ChecklistService } from './checklist.service';
import { OnboardingChecklist, ChecklistItemStatus } from './entities/onboarding-checklist.entity';

describe('ChecklistService', () => {
  let service: ChecklistService;
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
        ChecklistService,
        { provide: getRepositoryToken(OnboardingChecklist), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<ChecklistService>(ChecklistService);
  });

  describe('initializeChecklist', () => {
    it('should create default checklist items for a new provider', async () => {
      mockRepo.find.mockResolvedValue([]);
      mockRepo.create.mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue([]);

      await service.initializeChecklist('provider-1');
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('should return existing items without creating new ones', async () => {
      const existing = [{ id: '1', providerId: 'provider-1', itemKey: 'profile_complete' }];
      mockRepo.find.mockResolvedValue(existing);

      const result = await service.initializeChecklist('provider-1');
      expect(result).toEqual(existing);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('should return onboarding status with completion counts', async () => {
      const items = [
        { id: '1', providerId: 'p1', itemKey: 'profile_complete', itemLabel: 'Complete profile', status: ChecklistItemStatus.COMPLETED, completedAt: new Date() },
        { id: '2', providerId: 'p1', itemKey: 'identity_verified', itemLabel: 'Verify identity', status: ChecklistItemStatus.PENDING },
      ];
      mockRepo.find.mockResolvedValue(items);

      const result = await service.getStatus('p1');
      expect(result.completedCount).toBe(1);
      expect(result.totalCount).toBe(2);
      expect(result.isReady).toBe(false);
    });
  });

  describe('updateItem', () => {
    it('should update checklist item status', async () => {
      const item = { id: '1', providerId: 'p1', itemKey: 'profile_complete', status: ChecklistItemStatus.PENDING };
      mockRepo.findOne.mockResolvedValue(item);
      mockRepo.save.mockResolvedValue({ ...item, status: ChecklistItemStatus.COMPLETED, completedAt: new Date() });

      const result = await service.updateItem('p1', 'profile_complete', { status: ChecklistItemStatus.COMPLETED });
      expect(result.status).toBe(ChecklistItemStatus.COMPLETED);
    });

    it('should throw NotFoundException for unknown item key', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.updateItem('p1', 'unknown_key', { status: ChecklistItemStatus.COMPLETED })).rejects.toThrow(NotFoundException);
    });
  });
});
