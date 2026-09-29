/**
 * Tenant isolation integration test (issue #1215).
 *
 * Runs a representative tenant-scoped service against real Postgres and
 * proves that a caller in tenant A can neither read nor mutate tenant B's
 * rows through the supported repository query paths:
 *   reads  – findById, findByCondition, list, OR-search, count
 *   writes – scoped update, scoped delete, load/assert-ownership/save
 *
 * Database resolution, in order:
 *   1. Docker available  → a throwaway Postgres via Testcontainers.
 *   2. TEST_DATABASE_* / DATABASE_* env set (e.g. the CI Postgres service).
 *   3. Neither           → every test returns early (same convention as the
 *                          other Testcontainers suites).
 * All tables live in a uniquely-named schema that is dropped afterwards, so
 * running against a shared database leaves nothing behind.
 */

import { ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { DataSource, DataSourceOptions, Repository } from 'typeorm';
import { tenantStorage } from '../../src/tenancy/tenant-context';
import { TenantScopingService } from '../../src/tenancy/tenant-scoping.service';
import { TenantScopedQueryHelper } from '../../src/tenancy/helpers/tenant-scoped-query.helper';
import { isDockerAvailable } from '../helpers/testcontainers';
import {
  TENANT_A,
  TENANT_B,
  TenantRecord,
  TenantRecordService,
  tenantRecordSeed,
} from '../fixtures/tenant-isolation.fixture';

jest.setTimeout(120_000);

type PgConnection = Pick<
  Extract<DataSourceOptions, { type: 'postgres' }>,
  'host' | 'port' | 'username' | 'password' | 'database'
>;

function connectionFromEnv(): PgConnection | undefined {
  const env = (key: string) =>
    process.env[`TEST_DATABASE_${key}`] ?? process.env[`DATABASE_${key}`];
  if (!env('HOST')) return undefined;
  return {
    host: env('HOST'),
    port: parseInt(env('PORT') ?? '5432', 10),
    username: env('USER'),
    password: env('PASSWORD'),
    database: env('NAME'),
  };
}

async function startPostgres(): Promise<{
  container: StartedTestContainer;
  connection: PgConnection;
}> {
  const container = await new GenericContainer('postgres:15-alpine')
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'tenant_isolation',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2),
    )
    .start();
  return {
    container,
    connection: {
      host: container.getHost(),
      port: container.getMappedPort(5432),
      username: 'test',
      password: 'test',
      database: 'tenant_isolation',
    },
  };
}

const asTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  tenantStorage.run({ tenantId }, fn);

describe('Tenant isolation across repository query paths (integration)', () => {
  const schema = `tenant_iso_${randomBytes(4).toString('hex')}`;
  let container: StartedTestContainer | undefined;
  let admin: DataSource | undefined;
  let dataSource: DataSource | undefined;
  let repo: Repository<TenantRecord>;
  let service: TenantRecordService;
  let scoping: TenantScopingService;
  let events: { emit: jest.Mock };
  let ids: Record<string, string>;
  let dbAvailable = false;

  beforeAll(async () => {
    let connection = connectionFromEnv();
    if (await isDockerAvailable()) {
      ({ container, connection } = await startPostgres());
    }
    if (!connection) return;

    admin = await new DataSource({ type: 'postgres', ...connection }).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);

    dataSource = await new DataSource({
      type: 'postgres',
      ...connection,
      schema,
      uuidExtension: 'pgcrypto',
      entities: [TenantRecord],
      synchronize: true,
      logging: false,
    }).initialize();

    repo = dataSource.getRepository(TenantRecord);
    events = { emit: jest.fn() };
    scoping = new TenantScopingService(events as unknown as EventEmitter2);
    service = new TenantRecordService(
      repo,
      new TenantScopedQueryHelper(scoping),
      scoping,
    );
    dbAvailable = true;
  });

  afterAll(async () => {
    await dataSource?.destroy().catch(() => undefined);
    await admin
      ?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      .catch(() => undefined);
    await admin?.destroy().catch(() => undefined);
    await container?.stop().catch(() => undefined);
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await repo.clear();
    const saved = await repo.save(tenantRecordSeed().map((r) => repo.create(r)));
    ids = Object.fromEntries(
      saved.map((r) => [`${r.tenant_id === TENANT_A ? 'A' : 'B'}:${r.name}`, r.id]),
    );
    events.emit.mockClear();
  });

  const rowFor = (key: string) => repo.findOneByOrFail({ id: ids[key] });

  describe('reads', () => {
    it('findById returns own rows and nothing for another tenant’s id', async () => {
      if (!dbAvailable) return;
      await asTenant(TENANT_A, async () => {
        await expect(service.findById(ids['A:alpha-1'])).resolves.toMatchObject({
          name: 'alpha-1',
        });
        await expect(service.findById(ids['B:bravo-1'])).resolves.toBeNull();
      });
    });

    it('findByCondition does not cross over on values shared between tenants', async () => {
      if (!dbAvailable) return;
      const [fromA, fromB] = await Promise.all([
        asTenant(TENANT_A, () => service.findByName('shared-name')),
        asTenant(TENANT_B, () => service.findByName('shared-name')),
      ]);
      expect(fromA.map((r) => r.id)).toEqual([ids['A:shared-name']]);
      expect(fromB.map((r) => r.id)).toEqual([ids['B:shared-name']]);
      await asTenant(TENANT_A, async () => {
        await expect(service.findByName('bravo-1')).resolves.toEqual([]);
      });
    });

    it('list and count only see the active tenant', async () => {
      if (!dbAvailable) return;
      await asTenant(TENANT_A, async () => {
        const rows = await service.list();
        expect(rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
        expect(rows.map((r) => r.name)).toEqual(['alpha-1', 'alpha-2', 'shared-name']);
        await expect(service.count()).resolves.toBe(3);
      });
    });

    it('OR conditions cannot reach another tenant’s rows', async () => {
      if (!dbAvailable) return;
      await asTenant(TENANT_A, async () => {
        const rows = await service.search('alpha-1', 'bravo-1');
        expect(rows.map((r) => r.name)).toEqual(['alpha-1']);
      });
    });

    it('refuses to query without a tenant context', async () => {
      if (!dbAvailable) return;
      await expect(service.list()).rejects.toThrow(/No tenant context/);
      await expect(service.findById(ids['A:alpha-1'])).rejects.toThrow(
        /No tenant context/,
      );
    });
  });

  describe('writes', () => {
    it('scoped update changes own rows and leaves another tenant’s untouched', async () => {
      if (!dbAvailable) return;
      await asTenant(TENANT_A, async () => {
        await expect(service.updateBalance(ids['A:alpha-1'], 999)).resolves.toBe(1);
        await expect(service.updateBalance(ids['B:bravo-1'], 0)).resolves.toBe(0);
      });
      await expect(rowFor('A:alpha-1')).resolves.toMatchObject({ balance: 999 });
      await expect(rowFor('B:bravo-1')).resolves.toMatchObject({ balance: 300 });
    });

    it('scoped delete cannot remove another tenant’s row', async () => {
      if (!dbAvailable) return;
      await asTenant(TENANT_A, async () => {
        await expect(service.remove(ids['B:bravo-2'])).resolves.toBe(0);
        await expect(service.remove(ids['A:alpha-2'])).resolves.toBe(1);
      });
      await expect(repo.findOneBy({ id: ids['B:bravo-2'] })).resolves.not.toBeNull();
      await expect(repo.findOneBy({ id: ids['A:alpha-2'] })).resolves.toBeNull();
    });

    it('load/assert-ownership/save rejects another tenant’s row without writing', async () => {
      if (!dbAvailable) return;
      await asTenant(TENANT_A, async () => {
        await expect(service.rename(ids['B:bravo-1'], 'hijacked')).rejects.toThrow(
          ForbiddenException,
        );
        await expect(service.rename(ids['A:alpha-1'], 'alpha-renamed')).resolves.toMatchObject({
          name: 'alpha-renamed',
        });
      });
      await expect(rowFor('B:bravo-1')).resolves.toMatchObject({ name: 'bravo-1' });
    });

    it('creates rows owned by the active tenant only', async () => {
      if (!dbAvailable) return;
      const created = await asTenant(TENANT_B, () => service.create('bravo-new'));
      expect(created.tenant_id).toBe(TENANT_B);
      await asTenant(TENANT_A, async () => {
        await expect(service.findById(created.id)).resolves.toBeNull();
      });
    });
  });

  describe('cross-tenant escape hatch', () => {
    it('rejects unscoped access for non-super-admins', async () => {
      if (!dbAvailable) return;
      await asTenant(TENANT_A, async () => {
        await expect(
          scoping.unscopedQuery('ADMIN', 'support ticket', () => repo.find()),
        ).rejects.toThrow(ForbiddenException);
      });
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('audits super-admin unscoped access', async () => {
      if (!dbAvailable) return;
      const rows = await asTenant(TENANT_A, () =>
        scoping.unscopedQuery('SUPER_ADMIN', 'incident review', () => repo.find()),
      );
      expect(rows).toHaveLength(tenantRecordSeed().length);
      expect(events.emit).toHaveBeenCalledWith(
        'tenant.unscoped_access',
        expect.objectContaining({ originTenantId: TENANT_A, reason: 'incident review' }),
      );
    });
  });
});
