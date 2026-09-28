export const PROTECTED_SERVICES = ['auth', 'payment', 'trading', 'settlement'];

export function isProtectedService(serviceName: string): boolean {
  return PROTECTED_SERVICES.some((s) => serviceName.toLowerCase().includes(s));
}

export function buildRollbackAuditEntry(serviceName: string, userId: string, reason: string) {
  return {
    service: serviceName,
    requestedBy: userId,
    reason,
    timestamp: new Date().toISOString(),
    protected: isProtectedService(serviceName),
  };
}
