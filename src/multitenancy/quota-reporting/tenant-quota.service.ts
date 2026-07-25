import { ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { TenantUsage, TenantUsageType } from './entities/tenant-usage.entity';
import { QuotaReportDto, QuotaMetricReportDto } from './dto/quota-report.dto';
import { QuotaReportRequestDto } from './dto/quota-report-request.dto';
import { TenantConnectionProvider } from '../../tenancy/tenant-connection.provider';

export interface TenantQuotaRequester {
  id: string;
  tenantId?: string;
  roles?: string[];
}

const DEFAULT_QUOTAS: Record<TenantUsageType, { quota: number; unit: string }> = {
  [TenantUsageType.API_CALLS]: { quota: 100000, unit: 'calls' },
  [TenantUsageType.SIGNAL_SUBMISSIONS]: { quota: 10000, unit: 'submissions' },
  [TenantUsageType.STORAGE]: { quota: 500 * 1024 * 1024 * 1024, unit: 'bytes' },
};

@Injectable()
export class TenantQuotaService {
  private readonly logger = new Logger(TenantQuotaService.name);

  constructor(
    @InjectRepository(TenantUsage)
    private readonly usageRepository: Repository<TenantUsage>,
    @Optional()
    private readonly tenantConnection?: TenantConnectionProvider,
  ) {}

  /**
   * Returns the usage repository scoped to the active tenant's schema when a
   * tenant connection is available, falling back to the default connection.
   */
  private async resolveUsageRepository(): Promise<Repository<TenantUsage>> {
    if (this.tenantConnection) {
      return this.tenantConnection.getRepository(TenantUsage);
    }
    return this.usageRepository;
  }

  async generateReport(
    requester: TenantQuotaRequester,
    request: QuotaReportRequestDto = {},
    targetTenantId?: string,
  ): Promise<QuotaReportDto> {
    if (targetTenantId && targetTenantId !== (requester.tenantId ?? requester.id)) {
      this.assertPlatformAdmin(requester);
    } else {
      this.assertTenantAdmin(requester);
    }

    const tenantId = targetTenantId ?? requester.tenantId ?? requester.id;
    const periodStart = request.periodStart ? new Date(request.periodStart) : this.defaultPeriodStart();
    const periodEnd = request.periodEnd ? new Date(request.periodEnd) : new Date();
    const forecastDays = request.forecastDays ?? this.deriveForecastDays(periodStart, periodEnd);

    const usageRepository = await this.resolveUsageRepository();
    const usageRows = await usageRepository.find({
      where: {
        tenantId,
        recordedAt: Between(periodStart, periodEnd),
      },
      order: { recordedAt: 'DESC' },
    });

    const metrics = this.buildMetrics(usageRows, periodStart, periodEnd, forecastDays);

    this.logger.debug(
      `Generated quota report for tenant ${tenantId} with ${metrics.length} metrics`,
    );

    return {
      tenantId,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      generatedAt: new Date().toISOString(),
      metrics,
    };
  }

  private buildMetrics(
    rows: TenantUsage[],
    periodStart: Date,
    periodEnd: Date,
    forecastDays: number,
  ): QuotaMetricReportDto[] {
    const grouped = new Map<TenantUsageType, TenantUsage[]>();

    for (const row of rows) {
      const bucket = grouped.get(row.usageType as TenantUsageType) ?? [];
      bucket.push(row);
      grouped.set(row.usageType as TenantUsageType, bucket);
    }

    return Object.values(TenantUsageType).map((usageType) => {
      const defaults = DEFAULT_QUOTAS[usageType];
      const bucket = grouped.get(usageType) ?? [];
      const used = bucket.reduce((sum, row) => sum + Number(row.used ?? 0), 0);
      const quota = this.resolveQuota(bucket, defaults.quota);
      const unit = bucket[0]?.unit ?? defaults.unit;
      const remaining = Math.max(quota - used, 0);
      const utilizationPercentage = this.percent(used, quota);
      const forecastedUsage = this.forecastUsage(used, periodStart, periodEnd, forecastDays);
      const forecastedRemaining = Math.max(quota - forecastedUsage, 0);

      return {
        usageType,
        unit,
        used,
        quota,
        remaining,
        forecastedQuota: forecastedUsage,
        forecastedUsage,
        forecastedRemaining,
        utilizationPercentage,
        forecastedUtilizationPercentage: this.percent(forecastedUsage, quota),
      };
    });
  }

  private resolveQuota(rows: TenantUsage[], fallback: number): number {
    if (rows.length === 0) return fallback;
    return rows.reduce((max, row) => Math.max(max, Number(row.quota ?? 0)), fallback);
  }

  private forecastUsage(
    used: number,
    periodStart: Date,
    periodEnd: Date,
    forecastDays: number,
  ): number {
    const elapsedDays = Math.max((periodEnd.getTime() - periodStart.getTime()) / 86_400_000, 1);
    const dailyRate = used / elapsedDays;
    return dailyRate * Math.max(forecastDays, 1);
  }

  private percent(used: number, quota: number): number {
    if (!quota) return 0;
    return Number(((used / quota) * 100).toFixed(2));
  }

  private deriveForecastDays(periodStart: Date, periodEnd: Date): number {
    const deltaDays = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / 86_400_000);
    return Math.max(deltaDays, 1);
  }

  private defaultPeriodStart(): Date {
    return new Date(Date.now() - 30 * 86_400_000);
  }

  private assertTenantAdmin(requester: TenantQuotaRequester): void {
    const roles = (requester.roles ?? []).map((role) => role.toLowerCase());
    const isTenantAdmin =
      roles.includes('tenant-admin') ||
      roles.includes('tenant_admin') ||
      this.isPlatformAdmin(roles);

    if (!isTenantAdmin) {
      throw new ForbiddenException('Only tenant admins can access quota reports');
    }
  }

  private assertPlatformAdmin(requester: TenantQuotaRequester): void {
    const roles = (requester.roles ?? []).map((role) => role.toLowerCase());
    if (!this.isPlatformAdmin(roles)) {
      throw new ForbiddenException(
        'Viewing another tenant\'s quota report requires platform admin privileges',
      );
    }
  }

  private isPlatformAdmin(roles: string[]): boolean {
    return (
      roles.includes('admin') ||
      roles.includes('super_admin') ||
      roles.includes('platform_admin')
    );
  }
}
