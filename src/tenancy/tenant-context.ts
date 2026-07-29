/**
 * Async-local-storage based tenant context.
 * Stores the active tenantId for the duration of a request without
 * threading it through every function signature.
 */
import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  tenantId: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

/** Returns the tenantId for the current async context, or throws. */
export function getCurrentTenantId(): string {
  const ctx = tenantStorage.getStore();
  if (!ctx?.tenantId) {
    throw new Error('No tenant context found. Ensure TenantMiddleware is applied.');
  }
  return ctx.tenantId;
}

/** Returns the tenantId or null — safe to call outside request scope. */
export function getCurrentTenantIdOrNull(): string | null {
  return tenantStorage.getStore()?.tenantId ?? null;
}
