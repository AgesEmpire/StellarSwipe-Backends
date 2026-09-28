import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { RegionalFlagsService } from './regional-flags.service';
import { RegionalFlagConfig, RegionFlagStatus } from './entities/regional-flag-config.entity';
import { RegionResolver } from './utils/region-resolver';
import { FlagEvaluator } from './utils/flag-evaluator';

const mockRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  delete: jest.fn(),
});

describe('RegionalFlagsService', () => {
  let service: RegionalFlagsService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionalFlagsService,
        { provide: getRepositoryToken(RegionalFlagConfig), useFactory: mockRepo },
        RegionResolver,
        FlagEvaluator,
      ],
    }).compile();

    service = module.get(RegionalFlagsService);
    repo = module.get(getRepositoryToken(RegionalFlagConfig));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a regional flag config', async () => {
      const dto = { flagName: 'new-checkout', region: 'US', enabled: true };
      const config = { id: 'uuid-1', ...dto } as RegionalFlagConfig;
      repo.create.mockReturnValue(config);
      repo.save.mockResolvedValue(config);

      const result = await service.create(dto, 'admin-id');

      expect(repo.create).toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledWith(config);
      expect(result).toEqual(config);
    });
  });

  describe('update', () => {
    it('should throw NotFoundException when config does not exist', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.update('flag', 'US', { enabled: true }, 'user')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should update enabled status', async () => {
      const existing = { id: 'uuid-1', flagName: 'flag', region: 'US', enabled: false, overrides: {} } as RegionalFlagConfig;
      const updated = { ...existing, enabled: true };
      repo.findOne.mockResolvedValue(existing);
      repo.save.mockResolvedValue(updated);

      const result = await service.update('flag', 'US', { enabled: true }, 'user');

      expect(result.enabled).toBe(true);
    });
  });

  describe('delete', () => {
    it('should throw NotFoundException when no rows deleted', async () => {
      repo.delete.mockResolvedValue({ affected: 0 });
      await expect(service.delete('flag', 'US')).rejects.toThrow(NotFoundException);
    });

    it('should delete the config', async () => {
      repo.delete.mockResolvedValue({ affected: 1 });
      await expect(service.delete('flag', 'US')).resolves.toBeUndefined();
    });
  });

  describe('evaluateForRegion', () => {
    it('should return regional config when found', async () => {
      repo.find.mockResolvedValue([
        { flagName: 'flag', region: 'US', enabled: true, overrides: { theme: 'dark' } } as RegionalFlagConfig,
      ]);

      const result = await service.evaluateForRegion('flag', 'US', false);

      expect(result.enabled).toBe(true);
      expect(result.resolvedFrom).toBe('regional');
      expect(result.overrides).toEqual({ theme: 'dark' });
    });

    it('should fall back to global default when no config found', async () => {
      repo.find.mockResolvedValue([]);

      const result = await service.evaluateForRegion('flag', 'JP', true);

      expect(result.enabled).toBe(true);
      expect(result.resolvedFrom).toBe('default');
    });
  });

  describe('enableForRegion / disableForRegion', () => {
    it('should enable a flag for a region', async () => {
      const existing = { id: 'u1', flagName: 'f', region: 'EU', enabled: false } as RegionalFlagConfig;
      repo.findOne.mockResolvedValue(existing);
      repo.save.mockResolvedValue({ ...existing, enabled: true, status: RegionFlagStatus.ACTIVE });

      const result = await service.enableForRegion('f', 'EU', 'admin');

      expect(result.enabled).toBe(true);
      expect(result.status).toBe(RegionFlagStatus.ACTIVE);
    });
  });
});
