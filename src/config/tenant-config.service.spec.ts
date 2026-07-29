import { Test, TestingModule } from '@nestjs/testing';
import { TenantConfigService } from './tenant-config.service';
import { tenantStorage } from '../tenancy/tenant-context';

describe('TenantConfigService', () => {
  let service: TenantConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TenantConfigService],
    }).compile();

    service = module.get(TenantConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('feature flag overrides', () => {
    it('returns the tenant override when one is set (explicit tenantId)', () => {
      service.setFeatureFlagOverride('tenant-a', 'copy-trading', true);

      expect(service.resolveFeatureFlagOverride('copy-trading', 'tenant-a')).toBe(true);
    });

    it('returns undefined for a tenant without an override, so callers fall back to global default', () => {
      service.setFeatureFlagOverride('tenant-a', 'copy-trading', true);

      expect(service.resolveFeatureFlagOverride('copy-trading', 'tenant-b')).toBeUndefined();
    });

    it('returns undefined when there is no active tenant context (e.g. bootstrap/background jobs)', () => {
      service.setFeatureFlagOverride('tenant-a', 'copy-trading', true);

      expect(service.resolveFeatureFlagOverride('copy-trading', null)).toBeUndefined();
    });

    it('resolves using the currently active tenant context when tenantId is not passed explicitly', async () => {
      service.setFeatureFlagOverride('tenant-a', 'copy-trading', false);

      await tenantStorage.run({ tenantId: 'tenant-a' }, async () => {
        expect(service.resolveFeatureFlagOverride('copy-trading')).toBe(false);
      });

      // Outside the async-local-storage scope, there is no active tenant.
      expect(service.resolveFeatureFlagOverride('copy-trading')).toBeUndefined();
    });

    it('distinguishes an explicit false override from "no override" (undefined)', () => {
      service.setFeatureFlagOverride('tenant-a', 'kyc-required', false);

      const resolved = service.resolveFeatureFlagOverride('kyc-required', 'tenant-a');
      expect(resolved).toBe(false);
      expect(resolved).not.toBeUndefined();
    });

    it('clears a previously set override', () => {
      service.setFeatureFlagOverride('tenant-a', 'copy-trading', true);
      service.clearFeatureFlagOverride('tenant-a', 'copy-trading');

      expect(service.resolveFeatureFlagOverride('copy-trading', 'tenant-a')).toBeUndefined();
    });
  });

  describe('rate limit overrides', () => {
    const defaults = { limit: 10, window: 60 };

    it('returns the tenant override merged over defaults', () => {
      service.setRateLimitOverride('tenant-a', 'trade', { limit: 100 });

      const resolved = service.resolveRateLimit('trade', defaults, 'tenant-a');
      expect(resolved).toEqual({ limit: 100, window: 60 });
    });

    it('falls back to defaults for a tenant without an override', () => {
      service.setRateLimitOverride('tenant-a', 'trade', { limit: 100 });

      const resolved = service.resolveRateLimit('trade', defaults, 'tenant-b');
      expect(resolved).toEqual(defaults);
    });

    it('falls back to defaults when there is no active tenant context', () => {
      service.setRateLimitOverride('tenant-a', 'trade', { limit: 100 });

      const resolved = service.resolveRateLimit('trade', defaults, null);
      expect(resolved).toEqual(defaults);
    });

    it('merges a partial override (only window set) on top of defaults', () => {
      service.setRateLimitOverride('tenant-a', 'trade', { window: 300 });

      const resolved = service.resolveRateLimit('trade', defaults, 'tenant-a');
      expect(resolved).toEqual({ limit: 10, window: 300 });
    });

    it('keeps overrides scoped per rate-limit scope key (e.g. tier vs tier:account)', () => {
      service.setRateLimitOverride('tenant-a', 'trade', { limit: 100 });
      service.setRateLimitOverride('tenant-a', 'trade:account', { limit: 50 });

      expect(service.resolveRateLimit('trade', defaults, 'tenant-a').limit).toBe(100);
      expect(service.resolveRateLimit('trade:account', defaults, 'tenant-a').limit).toBe(50);
    });

    it('resolves using the currently active tenant context when tenantId is not passed explicitly', async () => {
      service.setRateLimitOverride('tenant-a', 'trade', { limit: 999 });

      await tenantStorage.run({ tenantId: 'tenant-a' }, async () => {
        expect(service.resolveRateLimit('trade', defaults).limit).toBe(999);
      });

      expect(service.resolveRateLimit('trade', defaults).limit).toBe(defaults.limit);
    });

    it('clears a previously set override', () => {
      service.setRateLimitOverride('tenant-a', 'trade', { limit: 100 });
      service.clearRateLimitOverride('tenant-a', 'trade');

      expect(service.resolveRateLimit('trade', defaults, 'tenant-a')).toEqual(defaults);
    });
  });

  describe('getOverridesForTenant', () => {
    it('returns an empty snapshot for an unknown tenant', () => {
      expect(service.getOverridesForTenant('unknown-tenant')).toEqual({
        featureFlags: {},
        rateLimits: {},
      });
    });

    it('returns a snapshot reflecting configured overrides', () => {
      service.setFeatureFlagOverride('tenant-a', 'copy-trading', true);
      service.setRateLimitOverride('tenant-a', 'trade', { limit: 100 });

      expect(service.getOverridesForTenant('tenant-a')).toEqual({
        featureFlags: { 'copy-trading': true },
        rateLimits: { trade: { limit: 100 } },
      });
    });
  });
});
