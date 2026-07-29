import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { TenantUsage } from './entities/tenant-usage.entity';
import { TenantQuotaService } from './tenant-quota.service';
import { ReportController } from './report.controller';
import { TenancyModule } from '../../tenancy/tenancy.module';

/**
 * #942 — Per-tenant usage reporting.
 *
 * Imports TenancyModule for tenant DataSource/connection routing instead of
 * re-declaring its own copies of those providers, so both modules share a
 * single instance rather than duplicating tenant-connection state.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TenantUsage]),
    AuthModule,
    TenancyModule,
  ],
  controllers: [ReportController],
  providers: [TenantQuotaService],
  exports: [TenantQuotaService],
})
export class QuotaReportingModule {}
