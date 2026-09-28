import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ApiKeyRotationService } from './api-key-rotation.service';
import { ApiKey } from '../../entities/api-key.entity';

describe('ApiKeyRotationService', () => {
  let service: ApiKeyRotationService;
  let mockRepo: any;

  beforeEach(async () => {
    mockRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyRotationService,
        { provide: getRepositoryToken(ApiKey), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<ApiKeyRotationService>(ApiKeyRotationService);
  });

  describe('scheduleRotation', () => {
    it('should schedule rotation for a valid key', async () => {
      const key = { id: 'k1', userId: 'u1' };
      mockRepo.findOne.mockResolvedValue(key);
      mockRepo.update.mockResolvedValue(undefined);

      const result = await service.scheduleRotation('u1', 'k1', { rotationIntervalDays: 30 });
      expect(result.nextRotationAt).toBeInstanceOf(Date);
      expect(mockRepo.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException for unknown key', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.scheduleRotation('u1', 'bad-id', { rotationIntervalDays: 30 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('rotateKey', () => {
    it('should rotate key and return new credentials', async () => {
      const key = { id: 'k1', userId: 'u1', keyHash: 'old-hash' };
      mockRepo.findOne.mockResolvedValue(key);
      mockRepo.update.mockResolvedValue(undefined);

      const result = await service.rotateKey('u1', 'k1');
      expect(result.newKey).toMatch(/^sk_live_[a-f0-9]{64}$/);
      expect(result.keyId).toBe('k1');
    });
  });

  describe('rotateExpiredKeys', () => {
    it('should rotate all expired keys and return count', async () => {
      mockRepo.find.mockResolvedValue([
        { id: 'k1', userId: 'u1' },
        { id: 'k2', userId: 'u2' },
      ]);
      mockRepo.update.mockResolvedValue(undefined);

      const count = await service.rotateExpiredKeys();
      expect(count).toBe(2);
    });

    it('should return 0 when no expired keys', async () => {
      mockRepo.find.mockResolvedValue([]);
      const count = await service.rotateExpiredKeys();
      expect(count).toBe(0);
    });
  });
});
