import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  tenantId: string;
  userId: string;
  scopes: string[];
  isAdmin?: boolean;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

export class TenantContextProvider {
  static getTenantContext(): TenantContext | undefined {
    return tenantContextStorage.getStore();
  }

  static getTenantId(): string | undefined {
    return tenantContextStorage.getStore()?.tenantId;
  }

  static setTenantContext(context: TenantContext) {
    return tenantContextStorage.run(context, () => context);
  }

  static isCurrentTenant(tenantId: string): boolean {
    const current = tenantContextStorage.getStore();
    return current?.tenantId === tenantId;
  }

  static hasScope(scope: string): boolean {
    const context = tenantContextStorage.getStore();
    if (!context) return false;
    
    // Support wildcard scopes (e.g., 'tenant:123:*' matches all tenant scopes)
    return context.scopes.some(s => s === scope || s === '*' || s.endsWith(':*'));
  }
}
