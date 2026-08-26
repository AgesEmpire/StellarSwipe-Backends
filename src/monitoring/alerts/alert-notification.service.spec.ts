import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AlertNotificationService } from './alert-notification.service';

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string, def?: unknown) => {
    const map: Record<string, unknown> = {
      ALERT_WEBHOOK_URL: 'https://ops.example.com/webhook',
      SLACK_ALERT_CHANNEL: '#ops-alerts',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.example.com/services/T000/B000/xxx',
    };
    return map[key] ?? def;
  }),
};

const stellarKey = 'G'.padEnd(56, 'A');

const buildAlert = (overrides: Record<string, unknown> = {}) => ({
  type: 'RPC_FAILURE',
  severity: 'critical' as const,
  timestamp: new Date('2026-01-01T00:00:00.000Z'),
  metrics: {
    failureCount: 12,
    affectedEndpoints: ['/soroban/simulate'],
    userEmail: 'jane.doe@example.com',
    walletAddress: stellarKey,
  },
  message: `Soroban RPC failing for account ${stellarKey}, contact jane.doe@example.com`,
  ...overrides,
});

describe('AlertNotificationService redaction', () => {
  let service: AlertNotificationService;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertNotificationService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(AlertNotificationService);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('strips PII from the webhook payload before it is sent externally (redacted path)', async () => {
    await service.handleSorobanAlert(buildAlert() as any);

    const webhookCall = fetchMock.mock.calls.find(
      (call) => call[0] === 'https://ops.example.com/webhook',
    );
    expect(webhookCall).toBeDefined();

    const body = JSON.parse(webhookCall![1].body);
    expect(JSON.stringify(body)).not.toContain('jane.doe@example.com');
    expect(JSON.stringify(body)).not.toContain(stellarKey);
    expect(body.metrics.userEmail).toBe('[REDACTED_EMAIL]');
    expect(body.message).toContain('[REDACTED_EMAIL]');
    expect(body.message).toContain('[REDACTED_STELLAR_KEY]');
  });

  it('strips PII from the Slack payload before it is sent externally (redacted path)', async () => {
    await service.handleSorobanAlert(buildAlert() as any);

    const slackCall = fetchMock.mock.calls.find(
      (call) => call[0] === 'https://hooks.slack.example.com/services/T000/B000/xxx',
    );
    expect(slackCall).toBeDefined();

    const body = JSON.parse(slackCall![1].body);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain('jane.doe@example.com');
    expect(serialised).not.toContain(stellarKey);
  });

  it('strips PII before writing to structured logs (redacted path)', async () => {
    await service.handleSorobanAlert(buildAlert() as any);

    const monitoringCall = (service as any).logger.log.mock.calls.find(
      (call: unknown[]) => call[0] === 'MONITORING_ALERT',
    );
    expect(monitoringCall).toBeDefined();

    const loggedPayload = monitoringCall[1];
    expect(JSON.stringify(loggedPayload)).not.toContain('jane.doe@example.com');
    expect(JSON.stringify(loggedPayload)).not.toContain(stellarKey);
  });

  it('leaves non-sensitive fields untouched (non-redacted path)', async () => {
    await service.handleSorobanAlert(buildAlert() as any);

    const webhookCall = fetchMock.mock.calls.find(
      (call) => call[0] === 'https://ops.example.com/webhook',
    );
    const body = JSON.parse(webhookCall![1].body);

    expect(body.metrics.failureCount).toBe(12);
    expect(body.metrics.affectedEndpoints).toEqual(['/soroban/simulate']);
    expect(body.alert_type).toBe('RPC_FAILURE');
    expect(body.severity).toBe('critical');
  });

  it('does not throw when metrics contain no PII at all (non-redacted path)', async () => {
    const alert = buildAlert({
      metrics: { failureCount: 1, affectedEndpoints: [] },
      message: 'Transient RPC timeout, no user data involved',
    });

    await expect(service.handleSorobanAlert(alert as any)).resolves.not.toThrow();
  });
});
