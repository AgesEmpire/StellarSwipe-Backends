import { ConfigService } from '@nestjs/config';
import { TenantFeatureFlagsService } from './tenant-feature-flags.service';

describe('TenantFeatureFlagsService', () => {
  const makeService = (env: Record<string, string>) => {
    const configService = {
      get: (k: string) => env[k],
    } as unknown as ConfigService;
    return new TenantFeatureFlagsService(configService);
  };

  it('returns disabled for an unknown flag', () => {
    const service = makeService({ NODE_ENV: 'test' });
    const result = service.evaluate('does-not-exist', 'tenant-a');
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('unknown-flag');
  });

  it('falls back to defaultEnabled when no override or rollout applies', () => {
    const service = makeService({
      NODE_ENV: 'test',
      FEATURE_FLAGS_JSON: JSON.stringify([{ key: 'new-ui', defaultEnabled: true }]),
    });
    expect(service.isEnabled('new-ui', 'tenant-a')).toBe(true);
  });

  it('applies a tenant-scoped override over the default', () => {
    const service = makeService({
      NODE_ENV: 'test',
      FEATURE_FLAGS_JSON: JSON.stringify([
        {
          key: 'new-ui',
          defaultEnabled: false,
          overrides: [{ tenantId: 'tenant-a', enabled: true }],
        },
      ]),
    });
    expect(service.isEnabled('new-ui', 'tenant-a')).toBe(true);
    expect(service.isEnabled('new-ui', 'tenant-b')).toBe(false);
  });

  it('respects env-scoped overrides', () => {
    const service = makeService({
      NODE_ENV: 'production',
      FEATURE_FLAGS_JSON: JSON.stringify([
        {
          key: 'beta-feature',
          defaultEnabled: true,
          overrides: [{ env: 'production', enabled: false }],
        },
      ]),
    });
    expect(service.isEnabled('beta-feature', 'tenant-a')).toBe(false);
  });

  it('deterministically buckets tenants for rollout percentage', () => {
    const service = makeService({
      NODE_ENV: 'test',
      FEATURE_FLAGS_JSON: JSON.stringify([
        { key: 'gradual', defaultEnabled: false, rolloutPercentage: 50 },
      ]),
    });
    const first = service.isEnabled('gradual', 'tenant-a');
    const second = service.isEnabled('gradual', 'tenant-a');
    expect(first).toBe(second);
  });

  it('0% rollout disables for everyone, 100% enables for everyone', () => {
    const off = makeService({
      NODE_ENV: 'test',
      FEATURE_FLAGS_JSON: JSON.stringify([
        { key: 'gradual', defaultEnabled: true, rolloutPercentage: 0 },
      ]),
    });
    expect(off.isEnabled('gradual', 'tenant-x')).toBe(false);

    const on = makeService({
      NODE_ENV: 'test',
      FEATURE_FLAGS_JSON: JSON.stringify([
        { key: 'gradual', defaultEnabled: false, rolloutPercentage: 100 },
      ]),
    });
    expect(on.isEnabled('gradual', 'tenant-x')).toBe(true);
  });
});
