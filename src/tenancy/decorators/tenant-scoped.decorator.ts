import { SetMetadata } from '@nestjs/common';

export const TENANT_SCOPED_KEY = 'tenant_scoped_entity';

/**
 * Marks an entity as tenant-scoped, meaning all queries on this entity
 * must explicitly use tenant scoping via TenantScopingService.scopeQuery().
 */
export const TenantScoped = () => SetMetadata(TENANT_SCOPED_KEY, true);
