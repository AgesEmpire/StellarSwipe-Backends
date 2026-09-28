import { Test, TestingModule } from '@nestjs/testing';
import { SecretsLoaderService } from './secrets-loader.service';
import { ConfigService } from '@nestjs/config';

describe('SecretsLoaderService', () => {
  let service: SecretsLoaderService;

  const mockConfigService = {
    get: jest.fn((key: string, def?: any) => {
      const values: Record<string, any> = {
        SECRET_PROVIDER: 'env',
      };
      return values[key] ?? def;
    }),
  };

  beforeEach(async () => {
    process.env.DATABASE_PASSWORD = 'test-db-pass';
    process.env.JWT_SECRET = 'test-jwt-secret';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretsLoaderService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<SecretsLoaderService>(SecretsLoaderService);
  });

  afterEach(() => {
    delete process.env.DATABASE_PASSWORD;
    delete process.env.JWT_SECRET;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return the provider name', () => {
    expect(service.getProvider()).toBe('env');
  });

  describe('env provider (local dev fallback)', () => {
    it('should load secrets from environment variables', async () => {
      const value = await service.getSecret('database.password');
      expect(value).toBe('test-db-pass');
    });

    it('should load JWT secret from env', async () => {
      const value = await service.getSecret('jwt.secret');
      expect(value).toBe('test-jwt-secret');
    });

    it('should return undefined for unknown secrets', async () => {
      const value = await service.getSecret('nonexistent.secret');
      expect(value).toBeUndefined();
    });

    it('should cache loaded secrets', async () => {
      const spy = jest.spyOn(process.env, '__defineGetter__');
      const v1 = await service.getSecret('database.password');
      const v2 = await service.getSecret('database.password');
      expect(v1).toBe(v2);
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate a single cached secret', async () => {
      await service.getSecret('database.password');
      service.invalidate('database.password');
      // After invalidation, it should re-read from env
      const value = await service.getSecret('database.password');
      expect(value).toBe('test-db-pass');
    });

    it('should invalidate all cached secrets', async () => {
      await service.getSecret('database.password');
      await service.getSecret('jwt.secret');
      service.invalidateAll();
      // Both should be re-read from env
      const dbPass = await service.getSecret('database.password');
      const jwtSecret = await service.getSecret('jwt.secret');
      expect(dbPass).toBe('test-db-pass');
      expect(jwtSecret).toBe('test-jwt-secret');
    });
  });

  describe('bulk loading', () => {
    it('should load multiple secrets at once', async () => {
      const results = await service.getSecrets([
        'database.password',
        'jwt.secret',
        'nonexistent',
      ]);
      expect(results['database.password']).toBe('test-db-pass');
      expect(results['jwt.secret']).toBe('test-jwt-secret');
      expect(results['nonexistent']).toBeUndefined();
    });
  });

  describe('vault provider fallback', () => {
    it('should fall back to env when vault is not configured', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'SECRET_PROVIDER') return 'vault';
        if (key === 'VAULT_URL') return undefined;
        if (key === 'VAULT_TOKEN') return undefined;
        return undefined;
      });

      const freshModule = await Test.createTestingModule({
        providers: [
          SecretsLoaderService,
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const freshService = freshModule.get(SecretsLoaderService);
      const value = await freshService.getSecret('database.password');
      expect(value).toBe('test-db-pass'); // fell back to env
    });
  });
});
