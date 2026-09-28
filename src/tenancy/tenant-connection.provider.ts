/**
 * TenantConnectionProvider
 *
 * Request-scoped provider that resolves the tenant identifier from the
 * authenticated request (JWT `tenantId` claim, falling back to the
 * `X-Tenant-ID` header) and exposes a TypeORM `DataSource`/`Repository`
 * bound to that tenant's schema. Feature modules inject this provider
 * instead of managing tenant routing themselves.
 *
 * Requests without a resolvable tenant are rejected with a clear error.
 */
import {
  Inject,
  Injectable,
  Scope,
  UnauthorizedException,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { DataSource, EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { TenantDataSourceFactory } from './tenant-connection.factory';

@Injectable({ scope: Scope.REQUEST })
export class TenantConnectionProvider {
  constructor(
    @Inject(REQUEST) private readonly request: Record<string, any>,
    private readonly factory: TenantDataSourceFactory,
  ) {}

  /** Resolves the tenant id from the request, or throws if absent. */
  getTenantId(): string {
    const tenantId =
      this.request?.user?.tenantId ??
      (this.request?.headers?.['x-tenant-id'] as string | undefined);

    if (!tenantId) {
      throw new UnauthorizedException(
        'Unable to resolve tenant: missing JWT tenantId claim or X-Tenant-ID header',
      );
    }

    return String(tenantId);
  }

  /** Postgres schema name for the active tenant. */
  getSchemaName(): string {
    return `tenant_${this.sanitize(this.getTenantId())}`;
  }

  /** DataSource bound to the active tenant's schema. */
  async getDataSource(): Promise<DataSource> {
    return this.factory.getDataSource(this.getSchemaName());
  }

  /** Repository for `entity` scoped to the active tenant's schema. */
  async getRepository<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
  ): Promise<Repository<T>> {
    const dataSource = await this.getDataSource();
    return dataSource.getRepository(entity);
  }

  private sanitize(tenantId: string): string {
    return tenantId.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  }
}
