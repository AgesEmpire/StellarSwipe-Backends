/**
 * Default retention windows (in days) for record types that grow unbounded
 * over time. Each default can be overridden via the matching environment
 * variable so operators can tighten/loosen retention per environment without
 * a code change.
 *
 * Days-to-live semantics: a record is eligible for cleanup once
 * `now - recordTimestamp > retentionDays`.
 */
export interface RetentionDefaults {
  auditLogDays: number;
  integrationEventDays: number;
  webhookDeliveryDays: number;
  notificationDeliveryLogDays: number;
}

export const RETENTION_ENV_KEYS: Record<keyof RetentionDefaults, string> = {
  auditLogDays: 'RETENTION_AUDIT_LOG_DAYS',
  integrationEventDays: 'RETENTION_INTEGRATION_EVENT_DAYS',
  webhookDeliveryDays: 'RETENTION_WEBHOOK_DELIVERY_DAYS',
  notificationDeliveryLogDays: 'RETENTION_NOTIFICATION_LOG_DAYS',
};

export const RETENTION_DEFAULTS: RetentionDefaults = {
  /** Audit trail — kept long for compliance/investigations. */
  auditLogDays: 730,
  /** Outbox / integration events — only need to survive long enough to be
   * relayed and debugged; published events are pruned much sooner. */
  integrationEventDays: 30,
  /** Webhook delivery attempts — operational log, short-lived. */
  webhookDeliveryDays: 90,
  /** Notification delivery audit log — operational log, short-lived. */
  notificationDeliveryLogDays: 90,
};

/**
 * Resolves the effective retention window for `key`, preferring the
 * environment override over the hard-coded default.
 */
export function resolveRetentionDays(
  key: keyof RetentionDefaults,
  getEnv: (name: string) => string | undefined = (name) => process.env[name],
): number {
  const raw = getEnv(RETENTION_ENV_KEYS[key]);
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : RETENTION_DEFAULTS[key];
}
