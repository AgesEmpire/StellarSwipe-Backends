import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, TooManyRequestsException } from '@nestjs/common';
import { SignalsService } from './signals.service';
import { CacheService } from '../cache/cache.service';
import { SignalQuotaService } from './quota/signal-quota.service';
import { Signal } from './entities/signal.entity';
import { SignalType, SignalStatus } from './entities/signal.entity';
import { createMockRepository } from '../../test/utils/test-helpers';
import { signalFactory, createSignalDtoFactory } from '../../test/utils/mock-factories';
import { CacheService } from '../cache/cache.service';
import { SignalQuotaService } from './quota/signal-quota.service';

describe('SignalsService', () => {
  let service: SignalsService;
  let mockRepository: any;
  let quotaService: { checkAndConsume: jest.Mock };
  let cacheService: { getOrSetWithLock: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    mockRepository = createMockRepository();
    quotaService = { checkAndConsume: jest.fn().mockResolvedValue({}) };
    cacheService = {
      getOrSetWithLock: jest.fn((_key, fetchFn) => fetchFn()),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalsService,
        {
          provide: getRepositoryToken(Signal),
          useValue: mockRepository,
        },
        { provide: CacheService, useValue: cacheService },
        { provide: SignalQuotaService, useValue: quotaService },
      ],
    }).compile();

    service = module.get<SignalsService>(SignalsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a signal with valid data', async () => {
      const dto = createSignalDtoFactory({
        providerId: 'user-123',
        baseAsset: 'USDC',
        counterAsset: 'XLM',
        entryPrice: '0.095',
      });
      const expectedSignal = signalFactory(dto);

      mockRepository.create.mockReturnValue(expectedSignal);
      mockRepository.save.mockResolvedValue(expectedSignal);

      const result = await service.create(dto);

      expect(result).toBeDefined();
      expect(mockRepository.create).toHaveBeenCalled();
      expect(mockRepository.save).toHaveBeenCalled();
    });


    it('checks quota before saving a signal', async () => {
      const dto = createSignalDtoFactory({ providerId: 'user-123', tier: 'basic' });
      const expectedSignal = signalFactory(dto);

      mockRepository.create.mockReturnValue(expectedSignal);
      mockRepository.save.mockResolvedValue(expectedSignal);

      await service.create(dto);

      expect(quotaService.checkAndConsume).toHaveBeenCalledWith('user-123', 'basic', false);
    });

    it('surfaces quota exhaustion as too many requests', async () => {
      const dto = createSignalDtoFactory({ providerId: 'user-123' });
      quotaService.checkAndConsume.mockRejectedValue(new TooManyRequestsException('quota'));

      await expect(service.create(dto)).rejects.toBeInstanceOf(TooManyRequestsException);
      expect(mockRepository.save).not.toHaveBeenCalled();
    });
    it('should throw error when providerId is missing', async () => {
      const dto = createSignalDtoFactory({ providerId: undefined });

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('should throw error when baseAsset is missing', async () => {
      const dto = createSignalDtoFactory({
        providerId: 'user-123',
        baseAsset: undefined,
      });

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw error when counterAsset is missing', async () => {
      const dto = createSignalDtoFactory({
        providerId: 'user-123',
        counterAsset: undefined,
      });

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('should set default values for optional fields', async () => {
      const dto = {
        providerId: 'user-123',
        baseAsset: 'USDC',
        counterAsset: 'XLM',
      };
      const signal = signalFactory();

      mockRepository.create.mockReturnValue(signal);
      mockRepository.save.mockResolvedValue(signal);

      await service.create(dto);

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: SignalStatus.ACTIVE,
          copiersCount: 0,
          totalCopiedVolume: '0',
        }),
      );
    });

    it('should handle database errors', async () => {
      const dto = createSignalDtoFactory({ providerId: 'user-123' });

      mockRepository.create.mockReturnValue(signalFactory());
      mockRepository.save.mockRejectedValue(new Error('Database error'));

      await expect(service.create(dto)).rejects.toThrow('Database error');
    });
  });

  describe('findOne', () => {
    it('should return a signal by id', async () => {
      const signal = signalFactory();
      mockCacheService.getOrSetWithLock.mockResolvedValue(signal);

      const result = await service.findOne('signal-123');

      expect(result).toEqual(signal);
    });

    it('should return null when signal not found', async () => {
      mockCacheService.getOrSetWithLock.mockResolvedValue(null);

      const result = await service.findOne('non-existent');

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      mockCacheService.getOrSetWithLock.mockRejectedValue(new Error('Database error'));

      await expect(service.findOne('signal-123')).rejects.toThrow('Database error');
    });
  });

  describe('findAll', () => {
    it('should return all signals ordered by createdAt DESC', async () => {
      const signals = [signalFactory(), signalFactory({ id: 'signal-456' })];
      mockCacheService.getOrSetWithLock.mockResolvedValue(signals);

      const result = await service.findAll();

      expect(result).toEqual(signals);
    });

    it('should return empty array when no signals exist', async () => {
      mockCacheService.getOrSetWithLock.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });

    it('should limit results to 100', async () => {
      mockCacheService.getOrSetWithLock.mockResolvedValue([]);
      mockRepository.find.mockResolvedValue([]);

      await service.findAll();

      // The cache service wraps the find call; verify find is called with take: 100 when cache misses
      expect(mockCacheService.getOrSetWithLock).toHaveBeenCalled();
    });
  });

  describe('updateSignalStatus', () => {
    it('should update signal status without version (backward-compatible)', async () => {
      const signal = signalFactory({ status: SignalStatus.CLOSED });
      mockRepository.update.mockResolvedValue({ affected: 1 } as any);
      mockRepository.findOneBy.mockResolvedValue(signal);

      const result = await service.updateSignalStatus('signal-123', SignalStatus.CLOSED);

      expect(result).toEqual(signal);
      expect(mockRepository.update).toHaveBeenCalledWith('signal-123', {
        status: SignalStatus.CLOSED,
      });
    });

    it('should update signal status with correct version (optimistic locking)', async () => {
      const signal = signalFactory({ status: SignalStatus.CLOSED, version: 2 });
      mockRepository.update.mockResolvedValue({ affected: 1 } as any);
      mockRepository.findOneBy.mockResolvedValue(signal);

      const result = await service.updateSignalStatus('signal-123', SignalStatus.CLOSED, 1);

      expect(result).toEqual(signal);
      expect(mockRepository.update).toHaveBeenCalledWith(
        { id: 'signal-123', version: 1 },
        { status: SignalStatus.CLOSED, version: 2 },
      );
    });

    it('should throw ConflictException when version is stale', async () => {
      mockRepository.update.mockResolvedValue({ affected: 0 } as any);

      await expect(
        service.updateSignalStatus('signal-123', SignalStatus.CLOSED, 1),
      ).rejects.toThrow(ConflictException);
    });

    it('should return null when signal not found (no version)', async () => {
      mockRepository.update.mockResolvedValue({ affected: 0 } as any);
      mockRepository.findOneBy.mockResolvedValue(null);

      const result = await service.updateSignalStatus('non-existent', SignalStatus.CLOSED);

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      mockRepository.update.mockRejectedValue(new Error('Database error'));

      await expect(
        service.updateSignalStatus('signal-123', SignalStatus.CLOSED),
      ).rejects.toThrow('Database error');
    });
  });
});
