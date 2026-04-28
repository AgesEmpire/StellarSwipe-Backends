import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SchemaVersioningService } from './schema-versioning.service';
import { SchemaVersion } from './schema-version.entity';

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

describe('SchemaVersioningService', () => {
  let service: SchemaVersioningService;
  let repo: jest.Mocked<Repository<SchemaVersion>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchemaVersioningService,
        { provide: getRepositoryToken(SchemaVersion), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(SchemaVersioningService);
    repo = module.get(getRepositoryToken(SchemaVersion));
  });

  afterEach(() => jest.clearAllMocks());

  describe('register', () => {
    it('should create and save a new schema version entry', async () => {
      const entry = {
        id: 'uuid-1',
        entityName: 'User',
        version: 1,
        description: 'initial',
        isCompatible: true,
        migrationName: null,
        appliedAt: new Date(),
      } as SchemaVersion;

      repo.findOne.mockResolvedValue(null);
      repo.create.mockReturnValue(entry);
      repo.save.mockResolvedValue(entry);

      const result = await service.register('User', 1, {
        description: 'initial',
      });

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { entityName: 'User', version: 1 },
      });
      expect(repo.create).toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledWith(entry);
      expect(result).toEqual(entry);
    });

    it('should return existing entry without saving if already registered', async () => {
      const existing = {
        id: 'uuid-1',
        entityName: 'User',
        version: 1,
      } as SchemaVersion;

      repo.findOne.mockResolvedValue(existing);

      const result = await service.register('User', 1);

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });
  });

  describe('getCurrentVersion', () => {
    it('should return the highest version number for an entity', async () => {
      repo.findOne.mockResolvedValue({ version: 3 } as SchemaVersion);
      const version = await service.getCurrentVersion('Trade');
      expect(version).toBe(3);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { entityName: 'Trade' },
        order: { version: 'DESC' },
      });
    });

    it('should return null when no versions exist', async () => {
      repo.findOne.mockResolvedValue(null);
      const version = await service.getCurrentVersion('Unknown');
      expect(version).toBeNull();
    });
  });

  describe('getHistory', () => {
    it('should return all versions for an entity in ascending order', async () => {
      const versions = [
        { version: 1 },
        { version: 2 },
        { version: 3 },
      ] as SchemaVersion[];

      repo.find.mockResolvedValue(versions);

      const result = await service.getHistory('Signal');

      expect(repo.find).toHaveBeenCalledWith({
        where: { entityName: 'Signal' },
        order: { version: 'ASC' },
      });
      expect(result).toHaveLength(3);
    });
  });

  describe('isCompatible', () => {
    it('should return true when version is marked compatible', async () => {
      repo.findOne.mockResolvedValue({
        isCompatible: true,
      } as SchemaVersion);
      expect(await service.isCompatible('User', 2)).toBe(true);
    });

    it('should return false when version is marked incompatible', async () => {
      repo.findOne.mockResolvedValue({
        isCompatible: false,
      } as SchemaVersion);
      expect(await service.isCompatible('User', 2)).toBe(false);
    });

    it('should return false when version does not exist', async () => {
      repo.findOne.mockResolvedValue(null);
      expect(await service.isCompatible('User', 99)).toBe(false);
    });
  });

  describe('checkCompatibility', () => {
    it('should return compatible true when current version meets requirement', async () => {
      repo.findOne
        .mockResolvedValueOnce({ version: 3 } as SchemaVersion) // getCurrentVersion
        .mockResolvedValueOnce({ isCompatible: true } as SchemaVersion); // isCompatible

      const result = await service.checkCompatibility('Trade', 2);

      expect(result).toEqual({ compatible: true, currentVersion: 3 });
    });

    it('should return compatible false when current version is below required', async () => {
      repo.findOne
        .mockResolvedValueOnce({ version: 1 } as SchemaVersion)
        .mockResolvedValueOnce({ isCompatible: true } as SchemaVersion);

      const result = await service.checkCompatibility('Trade', 3);

      expect(result).toEqual({ compatible: false, currentVersion: 1 });
    });

    it('should return compatible false when no version is registered', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.checkCompatibility('Trade', 1);

      expect(result).toEqual({ compatible: false, currentVersion: null });
    });
  });
});
