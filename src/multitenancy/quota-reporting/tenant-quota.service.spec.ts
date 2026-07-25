import { ForbiddenException } from '@nestjs/common';
import { TenantQuotaService } from './tenant-quota.service';
import { TenantUsage, TenantUsageType } from './entities/tenant-usage.entity';
import { Repository } from 'typeorm';

function makeRepo(rows: TenantUsage[] = []): jest.Mocked<Repository<TenantUsage>> {
  return {
    find: jest.fn().mockResolvedValue(rows),
  } as unknown as jest.Mocked<Repository<TenantUsage>>;
}

describe('TenantQuotaService', () => {
  it('generates a quota report with usage, remaining, and forecast values', async () => {
    const repo = makeRepo([
      {
        usageType: TenantUsageType.API_CALLS,
        used: 250,
        quota: 1000,
        unit: 'calls',
      } as TenantUsage,
      {
        usageType: TenantUsageType.SIGNAL_SUBMISSIONS,
        used: 12,
        quota: 100,
        unit: 'submissions',
      } as TenantUsage,
      {
        usageType: TenantUsageType.STORAGE,
        used: 128,
        quota: 512,
        unit: 'bytes',
      } as TenantUsage,
    ]);
    const service = new TenantQuotaService(repo);

    const report = await service.generateReport(
      { id: 'tenant-admin-1', tenantId: 'tenant-1', roles: ['tenant-admin'] },
      {
        periodStart: '2026-05-01T00:00:00.000Z',
        periodEnd: '2026-05-31T00:00:00.000Z',
        forecastDays: 30,
      },
    );

    expect(report.tenantId).toBe('tenant-1');
    expect(report.metrics).toHaveLength(3);
    expect(report.metrics.find((m) => m.usageType === TenantUsageType.API_CALLS)).toMatchObject({
      used: 250,
      remaining: 750,
      forecastedQuota: expect.any(Number),
      forecastedUsage: expect.any(Number),
    });
  });

  it('falls back to default quotas when there are no usage rows', async () => {
    const repo = makeRepo([]);
    const service = new TenantQuotaService(repo);

    const report = await service.generateReport(
      { id: 'tenant-admin-1', roles: ['tenant-admin'] },
      {},
    );

    expect(report.metrics.find((m) => m.usageType === TenantUsageType.API_CALLS)?.quota).toBe(
      100000,
    );
  });

  it('rejects non-admin callers', async () => {
    const service = new TenantQuotaService(makeRepo([]));

    await expect(
      service.generateReport({ id: 'user-1', roles: ['member'] }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a platform admin to view a different tenant quota report', async () => {
    const repo = makeRepo([
      { usageType: TenantUsageType.API_CALLS, used: 500, quota: 2000, unit: 'calls' } as TenantUsage,
    ]);
    const service = new TenantQuotaService(repo);

    const report = await service.generateReport(
      { id: 'admin-user', tenantId: 'admin-tenant', roles: ['admin'] },
      {},
      'other-tenant',
    );

    expect(report.tenantId).toBe('other-tenant');
    expect(report.metrics.find((m) => m.usageType === TenantUsageType.API_CALLS)).toMatchObject({
      used: 500,
    });
  });

  it('rejects a tenant-admin trying to view another tenant quota report', async () => {
    const service = new TenantQuotaService(makeRepo([]));

    await expect(
      service.generateReport(
        { id: 'tenant-admin-1', tenantId: 'tenant-1', roles: ['tenant-admin'] },
        {},
        'tenant-2',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
