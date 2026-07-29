import { UnauthorizedException } from '@nestjs/common';
import { TenantConnectionProvider } from './tenant-connection.provider';
import { TenantDataSourceFactory } from './tenant-connection.factory';

/**
 * Fake factory that hands back a distinct repository object per schema so we
 * can assert that two tenants are routed to isolated data sources.
 */
function makeFactory() {
  const repositoriesBySchema = new Map<string, { schema: string }>();
  const factory = {
    getDataSource: jest.fn(async (schema: string) => ({
      getRepository: jest.fn(() => {
        const existing = repositoriesBySchema.get(schema);
        if (existing) return existing;
        const repo = { schema };
        repositoriesBySchema.set(schema, repo);
        return repo;
      }),
    })),
  } as unknown as TenantDataSourceFactory;
  return { factory, repositoriesBySchema };
}

class Entity {}

describe('TenantConnectionProvider', () => {
  it('resolves the schema from the JWT tenantId claim', () => {
    const { factory } = makeFactory();
    const provider = new TenantConnectionProvider(
      { user: { tenantId: 'Acme' } },
      factory,
    );

    expect(provider.getTenantId()).toBe('Acme');
    expect(provider.getSchemaName()).toBe('tenant_acme');
  });

  it('falls back to the X-Tenant-ID header', () => {
    const { factory } = makeFactory();
    const provider = new TenantConnectionProvider(
      { headers: { 'x-tenant-id': 'globex' } },
      factory,
    );

    expect(provider.getSchemaName()).toBe('tenant_globex');
  });

  it('rejects requests without a resolvable tenant', () => {
    const { factory } = makeFactory();
    const provider = new TenantConnectionProvider({ headers: {} }, factory);

    expect(() => provider.getTenantId()).toThrow(UnauthorizedException);
  });

  it('routes two different tenants to isolated data sources', async () => {
    const { factory } = makeFactory();

    const tenantA = new TenantConnectionProvider(
      { user: { tenantId: 'alpha' } },
      factory,
    );
    const tenantB = new TenantConnectionProvider(
      { user: { tenantId: 'beta' } },
      factory,
    );

    const repoA = (await tenantA.getRepository(Entity)) as unknown as {
      schema: string;
    };
    const repoB = (await tenantB.getRepository(Entity)) as unknown as {
      schema: string;
    };

    expect(repoA.schema).toBe('tenant_alpha');
    expect(repoB.schema).toBe('tenant_beta');
    expect(repoA).not.toBe(repoB);
    expect(factory.getDataSource).toHaveBeenCalledWith('tenant_alpha');
    expect(factory.getDataSource).toHaveBeenCalledWith('tenant_beta');
  });
});
