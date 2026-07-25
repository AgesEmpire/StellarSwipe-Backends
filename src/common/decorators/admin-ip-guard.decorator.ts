import { SetMetadata } from '@nestjs/common';

export const ADMIN_IP_GUARD_KEY = 'admin_ip_guard';

export interface AdminIpGuardConfig {
  enabled?: boolean; // defaults to true; can be disabled per endpoint for dev/testing
}

export const AdminIpGuard = (config?: AdminIpGuardConfig) =>
  SetMetadata(ADMIN_IP_GUARD_KEY, {
    enabled: config?.enabled ?? true,
  });
