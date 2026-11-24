import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CopyPolicyVersion, CopyTradeExecution } from './copy-policy-version.entity';
import { CopyPolicyVersionService, DEFAULT_COPY_SETTINGS } from './copy-policy-version.service';

/** Minimal in-memory repository supporting the calls the service makes. */
function fakeRepo<T extends { id?: string }>() {
  const rows: T[] = [];
  let seq = 0;
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, v]) => row[k] === v);
  const clone = (r: T): T => JSON.parse(JSON.stringify(r));
  return {
    rows,
    create: jest.fn((data: Partial<T>) => ({ ...data }) as T),
    insert: jest.fn(async (entity: T) => {
      (entity as any).id = (entity as any).id ?? `id-${++seq}`;
      rows.push(clone(entity));
    }),
    findOne: jest.fn(async ({ where, order }: any) => {
      let found = rows.filter((r) => matches(r, where));
      if (order?.version === 'DESC') found = found.sort((a: any, b: any) => b.version - a.version);
      return found[0] ? clone(found[0]) : null;
    }),
    find: jest.fn(async ({ where }: any) =>
      rows
        .filter((r) => matches(r, where))
        .sort((a: any, b: any) => a.version - b.version)
        .map(clone),
    ),
  };
}

describe('CopyPolicyVersionService (#1520)', () => {
  const follower = 'follower-1';
  const provider = 'provider-1';
  let versions: ReturnType<typeof fakeRepo<CopyPolicyVersion>>;
  let executions: ReturnType<typeof fakeRepo<CopyTradeExecution>>;
  let service: CopyPolicyVersionService;

  beforeEach(() => {
    versions = fakeRepo<CopyPolicyVersion>();
    executions = fakeRepo<CopyTradeExecution>();
    service = new CopyPolicyVersionService(versions as any, executions as any);
  });

  it('creates an incrementing version on each policy change', async () => {
    const v1 = await service.updatePolicy(follower, provider, { allocationRatio: 0.5 });
    const v2 = await service.updatePolicy(follower, provider, { maxTradeAmount: 250 });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(v1.id);
    // partial update carries prior settings forward
    expect(v2.settings).toEqual({ ...DEFAULT_COPY_SETTINGS, allocationRatio: 0.5, maxTradeAmount: 250 });
    expect(versions.rows).toHaveLength(2);
  });

  it('does not create a version when the settings are unchanged', async () => {
    const v1 = await service.updatePolicy(follower, provider, { allocationRatio: 0.5 });
    const same = await service.updatePolicy(follower, provider, { allocationRatio: 0.5 });
    expect(same.id).toBe(v1.id);
    expect(versions.rows).toHaveLength(1);
  });

  it('never mutates earlier versions', async () => {
    await service.updatePolicy(follower, provider, { allocationRatio: 0.5 });
    await service.updatePolicy(follower, provider, { allocationRatio: 0.2 });
    const all = await service.listVersions(follower, provider);
    expect(all.map((v) => v.settings.allocationRatio)).toEqual([0.5, 0.2]);
  });

  it('keeps historical execution reads stable after a policy change', async () => {
    const v1 = await service.updatePolicy(follower, provider, {
      allocationRatio: 0.5,
      slippageTolerancePct: 1,
    });
    const exec = await service.recordExecution('trade-1', follower, provider);
    expect(exec.policyVersionId).toBe(v1.id);
    expect(exec.policyVersion).toBe(1);

    const v2 = await service.updatePolicy(follower, provider, {
      allocationRatio: 0.1,
      slippageTolerancePct: 3,
    });
    const later = await service.recordExecution('trade-2', follower, provider);

    const historical = await service.getExecution('trade-1');
    expect(historical.policyVersionId).toBe(v1.id);
    expect(historical.resolvedSettings.allocationRatio).toBe(0.5);
    expect(historical.resolvedSettings.slippageTolerancePct).toBe(1);

    expect(later.policyVersionId).toBe(v2.id);
    expect(later.resolvedSettings.allocationRatio).toBe(0.1);
  });

  it('returns frozen snapshots that cannot be mutated in memory', async () => {
    await service.updatePolicy(follower, provider, { allocationRatio: 0.5 });
    const exec = await service.recordExecution('trade-1', follower, provider);
    expect(Object.isFrozen(exec)).toBe(true);
    expect(Object.isFrozen(exec.resolvedSettings)).toBe(true);
  });

  it('records a default v1 policy when the follower has no custom settings', async () => {
    const exec = await service.recordExecution('trade-1', follower, provider);
    expect(exec.policyVersion).toBe(1);
    expect(exec.resolvedSettings).toEqual(DEFAULT_COPY_SETTINGS);
  });

  it('is idempotent per trade', async () => {
    const a = await service.recordExecution('trade-1', follower, provider);
    await service.updatePolicy(follower, provider, { allocationRatio: 0.3 });
    const b = await service.recordExecution('trade-1', follower, provider);
    expect(b.policyVersionId).toBe(a.policyVersionId);
    expect(executions.rows).toHaveLength(1);
  });

  it('rejects invalid settings', async () => {
    await expect(
      service.updatePolicy(follower, provider, { allocationRatio: 2 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updatePolicy(follower, provider, { stopLossPct: -1 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('surfaces concurrent version collisions as a conflict', async () => {
    versions.insert.mockRejectedValueOnce(new Error('duplicate key'));
    await expect(
      service.updatePolicy(follower, provider, { allocationRatio: 0.4 }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFound for unknown executions', async () => {
    await expect(service.getExecution('missing')).rejects.toThrow(NotFoundException);
  });
});
