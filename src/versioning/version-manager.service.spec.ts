import { Test, TestingModule } from '@nestjs/testing';
import { VersionManagerService } from './version-manager.service';
import { VersionStatus } from './interfaces/version-config.interface';

describe('VersionManagerService', () => {
  let service: VersionManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VersionManagerService],
    }).compile();

    service = module.get<VersionManagerService>(VersionManagerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDefaultVersion', () => {
    it('should return v1 as default', () => {
      expect(service.getDefaultVersion()).toBe('1');
    });
  });

  describe('isSupported', () => {
    it('should return true for v1 and v2', () => {
      expect(service.isSupported('1')).toBe(true);
      expect(service.isSupported('2')).toBe(true);
    });

    it('should return false for unknown versions', () => {
      expect(service.isSupported('3')).toBe(false);
      expect(service.isSupported('invalid')).toBe(false);
    });
  });

  describe('isDeprecated', () => {
    it('should return true for v1', () => {
      expect(service.isDeprecated('1')).toBe(true);
    });

    it('should return false for v2', () => {
      expect(service.isDeprecated('2')).toBe(false);
    });
  });

  describe('getVersionMetadata', () => {
    it('should return correct metadata for v1', () => {
      const meta = service.getVersionMetadata('1');
      expect(meta).toBeDefined();
      expect(meta?.status).toBe(VersionStatus.DEPRECATED);
      expect(meta?.sunsetDate).toBe('2025-12-31');
      expect(meta?.successorVersion).toBe('2');
    });

    it('should return correct metadata for v2', () => {
      const meta = service.getVersionMetadata('2');
      expect(meta).toBeDefined();
      expect(meta?.status).toBe(VersionStatus.SUPPORTED);
      expect(meta?.successorVersion).toBeUndefined();
    });

    it('should return null for unknown version', () => {
      expect(service.getVersionMetadata('99')).toBeNull();
    });
  });

  describe('getSupportedVersions', () => {
    it('should return [1, 2]', () => {
      const versions = service.getSupportedVersions();
      expect(versions).toContain('1');
      expect(versions).toContain('2');
      expect(versions.length).toBe(2);
    });
  });
});
