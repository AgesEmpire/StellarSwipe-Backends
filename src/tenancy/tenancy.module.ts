import { Module } from '@nestjs/common';
import { TenantScopingService } from './tenant-scoping.service';
import { TenantRlsSubscriber } from './tenant-rls.subscriber';
import { TenantDataSourceFactory } from './tenant-connection.factory';
import { TenantConnectionProvider } from './tenant-connection.provider';
import { TenantScopedQueryHelper } from './helpers/tenant-scoped-query.helper';

/**
 * #942 — Tenant-scoping and connection-routing providers.
 *
 * Intentionally NOT @Global(): these providers back a specific concern
 * (per-tenant DataSource/query routing) rather than app-wide infrastructure,
 * so consumers (e.g. QuotaReportingModule) import this module explicitly.
 */
@Module({
  providers: [
    TenantScopingService,
    TenantRlsSubscriber,
    TenantDataSourceFactory,
    TenantConnectionProvider,
    TenantScopedQueryHelper,
  ],
  exports: [
    TenantScopingService,
    TenantRlsSubscriber,
    TenantDataSourceFactory,
    TenantConnectionProvider,
    TenantScopedQueryHelper,
  ],
})
export class TenancyModule {}
