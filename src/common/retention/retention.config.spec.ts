import { resolveRetentionDays, RETENTION_DEFAULTS } from './retention.config';

describe('resolveRetentionDays', () => {
  it('falls back to the hard-coded default when no env var is set', () => {
    expect(resolveRetentionDays('auditLogDays', () => undefined)).toBe(
      RETENTION_DEFAULTS.auditLogDays,
    );
  });

  it('uses the env override when present and valid', () => {
    expect(resolveRetentionDays('integrationEventDays', () => '14')).toBe(14);
  });

  it('ignores invalid (non-numeric or non-positive) overrides and falls back to the default', () => {
    expect(resolveRetentionDays('webhookDeliveryDays', () => 'not-a-number')).toBe(
      RETENTION_DEFAULTS.webhookDeliveryDays,
    );
    expect(resolveRetentionDays('webhookDeliveryDays', () => '-5')).toBe(
      RETENTION_DEFAULTS.webhookDeliveryDays,
    );
    expect(resolveRetentionDays('webhookDeliveryDays', () => '0')).toBe(
      RETENTION_DEFAULTS.webhookDeliveryDays,
    );
  });
});
