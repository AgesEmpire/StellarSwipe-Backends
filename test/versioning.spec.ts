import { Test, TestingModule } from '@nestjs/testing';
import { VersionManagerService } from '../src/versioning/version-manager.service';
import { VersionResolverMiddleware } from '../src/versioning/middleware/version-resolver.middleware';
import { VersionCompatibilityGuard } from '../src/versioning/guards/version-compatibility.guard';
import { DeprecationInterceptor } from '../src/versioning/interceptors/deprecation.interceptor';
import { Reflector } from '@nestjs/core';
import { NotFoundException } from '@nestjs/common';

describe('API Versioning (#889)', () => {
  let versionManager: VersionManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VersionManagerService],
    }).compile();
    versionManager = module.get(VersionManagerService);
  });

  describe('VersionManagerService', () => {
    it('v2 should be supported', () => {
      expect(versionManager.isSupported('2')).toBe(true);
    });

    it('v1 should be supported but deprecated', () => {
      expect(versionManager.isSupported('1')).toBe(true);
      expect(versionManager.isDeprecated('1')).toBe(true);
    });

    it('unknown version should not be supported', () => {
      expect(versionManager.isSupported('99')).toBe(false);
    });

    it('getSupportedVersions should include v1 and v2', () => {
      expect(versionManager.getSupportedVersions()).toEqual(expect.arrayContaining(['1', '2']));
    });

    it('getDefaultVersion should return a string', () => {
      expect(typeof versionManager.getDefaultVersion()).toBe('string');
    });
  });

  describe('VersionResolverMiddleware', () => {
    let middleware: VersionResolverMiddleware;

    beforeEach(() => {
      middleware = new VersionResolverMiddleware(versionManager);
    });

    it('should resolve version from URL path', () => {
      const req: any = { path: '/api/v2/signals', headers: {} };
      const res: any = { setHeader: jest.fn() };
      const next = jest.fn();

      middleware.use(req, res, next);

      expect(req.apiVersion).toBe('2');
      expect(next).toHaveBeenCalled();
    });

    it('should resolve version from api-version header when no URL version', () => {
      const req: any = { path: '/api/signals', headers: { 'api-version': '2' } };
      const res: any = { setHeader: jest.fn() };
      const next = jest.fn();

      middleware.use(req, res, next);

      expect(req.apiVersion).toBe('2');
    });

    it('should set Deprecation header for v1 requests', () => {
      const req: any = { path: '/api/v1/signals', headers: {} };
      const res: any = { setHeader: jest.fn() };
      const next = jest.fn();

      middleware.use(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
      expect(res.setHeader).toHaveBeenCalledWith('Sunset', expect.any(String));
    });

    it('should throw NotFoundException for unsupported version', () => {
      const req: any = { path: '/api/v99/signals', headers: {} };
      const res: any = { setHeader: jest.fn() };

      expect(() => middleware.use(req, res, jest.fn())).toThrow(NotFoundException);
    });
  });

  describe('VersionCompatibilityGuard', () => {
    let guard: VersionCompatibilityGuard;
    let reflector: Reflector;

    beforeEach(() => {
      reflector = new Reflector();
      guard = new VersionCompatibilityGuard(reflector, versionManager);
    });

    it('should allow request for supported version', () => {
      const ctx: any = {
        switchToHttp: () => ({
          getRequest: () => ({ apiVersion: '2' }),
          getResponse: () => ({ setHeader: jest.fn() }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      };
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should throw GoneException for sunset version', () => {
      // Temporarily add a sunset version
      (versionManager as any).config.versions['0'] = { status: 'sunset' };
      const ctx: any = {
        switchToHttp: () => ({
          getRequest: () => ({ apiVersion: '0' }),
          getResponse: () => ({ setHeader: jest.fn() }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      };
      expect(() => guard.canActivate(ctx)).toThrow();
      delete (versionManager as any).config.versions['0'];
    });
  });

  describe('DeprecationInterceptor', () => {
    it('should set Deprecation header when @Deprecated() is present', () => {
      const reflector = new Reflector();
      const interceptor = new DeprecationInterceptor(reflector);

      jest.spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce(true)  // isDeprecated
        .mockReturnValueOnce({ sunsetDate: '2025-12-31', successorVersion: '2' });

      const setHeader = jest.fn();
      const ctx: any = {
        switchToHttp: () => ({
          getResponse: () => ({ setHeader }),
          getRequest: () => ({ method: 'GET', originalUrl: '/api/v1/test', user: null, ip: '127.0.0.1' }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      };
      const next: any = { handle: () => ({ pipe: jest.fn() }) };

      interceptor.intercept(ctx, next);

      expect(setHeader).toHaveBeenCalledWith('Deprecation', 'true');
      expect(setHeader).toHaveBeenCalledWith('Sunset', '2025-12-31');
    });

    it('should not set headers when @Deprecated() is absent', () => {
      const reflector = new Reflector();
      const interceptor = new DeprecationInterceptor(reflector);

      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(false);

      const setHeader = jest.fn();
      const ctx: any = {
        switchToHttp: () => ({
          getResponse: () => ({ setHeader }),
          getRequest: () => ({}),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      };
      const next: any = { handle: jest.fn().mockReturnValue({ pipe: jest.fn() }) };

      interceptor.intercept(ctx, next);

      expect(setHeader).not.toHaveBeenCalled();
    });
  });
});
