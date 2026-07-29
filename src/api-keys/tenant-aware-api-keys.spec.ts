import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { TenantAwareApiKeysService } from './tenant-aware-api-keys.service';
import { TenantAwareApiKeyGuard } from './guards/tenant-aware-api-key.guard';
import { ApiKeysService } from './api-keys.service';
import { ApiKey } from './entities/api-key.entity';
import { TenantContextProvider, tenantContextStorage } from '../common/tenant-context';

describe('Tenant-Aware API Keys', () => {
  let tenantService: TenantAwareApiKeysService;
  let guard: TenantAwareApiKeyGuard;
  let apiKeysService: ApiKeysService;

  const mockApiKeyRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantAwareApiKeysService,
        ApiKeysService,
        TenantAwareApiKeyGuard,
        {
          provide: getRepositoryToken(ApiKey),
          useValue: mockApiKeyRepository,
        },
        {
          provide: 'CACHE_MANAGER',
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    tenantService = module.get<TenantAwareApiKeysService>(
      TenantAwareApiKeysService,
    );
    apiKeysService = module.get<ApiKeysService>(ApiKeysService);
    guard = module.get<TenantAwareApiKeyGuard>(TenantAwareApiKeyGuard);
  });

  describe('Tenant Isolation', () => {
    it('should only allow access to API keys for the current tenant', async () => {
      const tenant1Id = 'tenant-1';
      const tenant2Id = 'tenant-2';
      const userId = 'user-1';

      const apiKey = {
        id: 'key-1',
        userId,
        tenantId: tenant1Id,
        name: 'Key 1',
        keyHash: 'hash',
        scopes: ['tenant:tenant-1:read_trades'],
        isActive: true,
      } as ApiKey;

      mockApiKeyRepository.findOne.mockResolvedValue(apiKey);

      // Should succeed for correct tenant
      await expect(
        tenantService.verifyTenantIsolation('key-1', tenant1Id),
      ).resolves.toBe(true);

      // Should fail for different tenant
      mockApiKeyRepository.findOne.mockResolvedValue(null);
      await expect(
        tenantService.verifyTenantIsolation('key-1', tenant2Id),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should prevent API key from being used across tenants', async () => {
      const apiKey = {
        id: 'key-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        keyHash: 'hash',
        scopes: ['tenant:tenant-1:read_trades'],
        expiresAt: null,
        isActive: true,
      } as ApiKey;

      // Try to access with different tenant
      const mockRequest = {
        headers: {
          authorization: 'Bearer sk_live_test',
          'x-tenant-id': 'tenant-2', // Different tenant
        },
        method: 'GET',
        path: '/api/trades',
        tenantContext: { tenantId: 'tenant-2' },
      } as any;

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
      } as any;

      jest.spyOn(apiKeysService, 'verify').mockResolvedValue(apiKey);
      jest.spyOn(apiKeysService, 'checkRateLimit').mockResolvedValue(true);

      // Should throw because tenant doesn't match
      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('Tenant-Scoped Permissions', () => {
    it('should validate tenant-scoped scopes', async () => {
      const apiKey = {
        id: 'key-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        scopes: ['tenant:tenant-1:read_trades', 'tenant:tenant-1:write_signals'],
        expiresAt: null,
        isActive: true,
        rateLimit: 1000,
      } as ApiKey;

      const mockRequest = {
        headers: {
          authorization: 'Bearer sk_live_test',
          'x-tenant-id': 'tenant-1',
        },
        method: 'GET',
        path: '/api/trades',
      } as any;

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
      } as any;

      jest.spyOn(apiKeysService, 'verify').mockResolvedValue(apiKey);
      jest.spyOn(apiKeysService, 'checkRateLimit').mockResolvedValue(true);
      jest.spyOn(apiKeysService, 'trackUsage').mockResolvedValue(undefined);

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(mockRequest.tenantId).toBe('tenant-1');
      expect(mockRequest.apiKey).toBe(apiKey);
    });

    it('should reject API key without valid tenant scope', async () => {
      const apiKey = {
        id: 'key-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        scopes: ['tenant:other-tenant:read_trades'], // Wrong tenant scope
        expiresAt: null,
        isActive: true,
      } as ApiKey;

      const mockRequest = {
        headers: {
          authorization: 'Bearer sk_live_test',
          'x-tenant-id': 'tenant-1',
        },
        method: 'GET',
        path: '/api/trades',
        tenantContext: { tenantId: 'tenant-1' },
      } as any;

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
      } as any;

      jest.spyOn(apiKeysService, 'verify').mockResolvedValue(apiKey);
      jest.spyOn(apiKeysService, 'checkRateLimit').mockResolvedValue(true);

      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow wildcard tenant scopes', async () => {
      const apiKey = {
        id: 'key-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        scopes: ['*'], // Admin scope
        expiresAt: null,
        isActive: true,
        rateLimit: 1000,
      } as ApiKey;

      const mockRequest = {
        headers: {
          authorization: 'Bearer sk_live_test',
          'x-tenant-id': 'any-tenant',
        },
        method: 'GET',
        path: '/api/trades',
      } as any;

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
      } as any;

      jest.spyOn(apiKeysService, 'verify').mockResolvedValue(apiKey);
      jest.spyOn(apiKeysService, 'checkRateLimit').mockResolvedValue(true);
      jest.spyOn(apiKeysService, 'trackUsage').mockResolvedValue(undefined);

      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
    });
  });

  describe('Tenant Context Management', () => {
    it('should retrieve keys by tenant', async () => {
      const keys = [
        { id: 'key-1', tenantId: 'tenant-1', userId: 'user-1' },
        { id: 'key-2', tenantId: 'tenant-1', userId: 'user-2' },
      ] as ApiKey[];

      mockApiKeyRepository.find.mockResolvedValue(keys);

      const result = await tenantService.getByTenant('tenant-1');

      expect(result).toHaveLength(2);
      expect(mockApiKeyRepository.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        order: { createdAt: 'DESC' },
      });
    });

    it('should revoke all keys for a tenant', async () => {
      mockApiKeyRepository.update.mockResolvedValue({ affected: 3 });

      const result = await tenantService.revokeByTenant('tenant-1');

      expect(result).toBe(3);
      expect(mockApiKeyRepository.update).toHaveBeenCalledWith(
        { tenantId: 'tenant-1', isActive: true },
        { isActive: false },
      );
    });

    it('should validate tenant access via context', async () => {
      const apiKey = {
        id: 'key-1',
        tenantId: 'tenant-1',
        isActive: true,
      } as ApiKey;

      mockApiKeyRepository.findOne.mockResolvedValue(apiKey);

      // Set up tenant context
      const context = { tenantId: 'tenant-1', userId: 'user-1', scopes: [], isAdmin: false };
      tenantContextStorage.run(context, async () => {
        const result = await tenantService.validateTenantAccess('key-1');
        expect(result).toBe(apiKey);
      });
    });

    it('should reject access if no tenant context', async () => {
      // No tenant context set
      TenantContextProvider.getTenantContext = jest.fn(() => undefined);

      await expect(
        tenantService.validateTenantAccess('key-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
