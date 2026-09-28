import { ForbiddenException } from '@nestjs/common';
import { ReportController } from './report.controller';

describe('ReportController', () => {
  it('passes the tenant identity and roles to the quota service', async () => {
    const service = {
      generateReport: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const controller = new ReportController(service);

    await controller.getQuotaReport(
      { user: { userId: 'u1', tenantId: 'tenant-1', roles: ['tenant-admin'] } },
      {},
    );

    expect(service.generateReport).toHaveBeenCalledWith(
      { id: 'u1', tenantId: 'tenant-1', roles: ['tenant-admin'] },
      {},
    );
  });

  it('surfaces access restriction errors from the service', async () => {
    const service = {
      generateReport: jest.fn().mockRejectedValue(new ForbiddenException()),
    } as any;
    const controller = new ReportController(service);

    await expect(
      controller.getQuotaReport(
        { user: { userId: 'u1', tenantId: 'tenant-1', roles: ['member'] } },
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('passes target tenantId and admin identity to the service for admin endpoint', async () => {
    const service = {
      generateReport: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const controller = new ReportController(service);

    await controller.getQuotaReportForTenant(
      { user: { userId: 'admin-1', tenantId: 'admin-tenant', roles: ['admin'] } },
      'other-tenant',
      {},
    );

    expect(service.generateReport).toHaveBeenCalledWith(
      { id: 'admin-1', tenantId: 'admin-tenant', roles: ['admin'] },
      {},
      'other-tenant',
    );
  });
});
