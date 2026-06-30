import { Module, Global } from '@nestjs/common';
import { TenantScopingService } from './tenant-scoping.service';
import { TenantRlsSubscriber } from './tenant-rls.subscriber';
import { TenantDataSourceFactory } from './tenant-connection.factory';
import { TenantConnectionProvider } from './tenant-connection.provider';
import { TenantScopedQueryHelper } from './helpers/tenant-scoped-query.helper';

@Global()
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
