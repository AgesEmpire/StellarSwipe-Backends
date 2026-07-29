import * as crypto from 'crypto';

export interface EncryptedStorageRequester {
  id: string;
  tenantId?: string;
  roles?: string[];
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

export function hashPayload(payload: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function canBypassPayloadAccess(requester: EncryptedStorageRequester): boolean {
  const roles = (requester.roles ?? []).map((role) => role.toLowerCase());
  return (
    roles.includes('admin') ||
    roles.includes('tenant-admin') ||
    roles.includes('tenant_admin') ||
    roles.includes('security-admin') ||
    roles.includes('security_admin')
  );
}
