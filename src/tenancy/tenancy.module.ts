import { Module, Global } from '@nestjs/common';
import { TenantScopingService } from './tenant-scoping.service';
import { TenantRlsSubscriber } from './tenant-rls.subscriber';

@Global()
@Module({
  providers: [TenantScopingService, TenantRlsSubscriber],
  exports: [TenantScopingService, TenantRlsSubscriber],
})
export class TenancyModule {}
