import { EscalationService } from './escalation.service';
import { AlertRuleDto, AlertSeverity } from './dto/alert-rule.dto';
import { NotificationChannel } from './dto/escalation-policy.dto';

describe('EscalationService', () => {
  let service: EscalationService;

  beforeEach(() => {
    service = new EscalationService();
  });

  it('assigns critical alerts to the highest default escalation level', async () => {
    const alert: AlertRuleDto = {
      id: 'alert-1',
      source: 'settlement-worker',
      severity: AlertSeverity.CRITICAL,
      message: 'Settlement queue stalled',
    };

    const result = await service.routeAlert(alert);

    expect(result.escalationLevel).toBe(3);
    expect(result.forwardedChannels).toEqual([
      NotificationChannel.PAGERDUTY,
      NotificationChannel.SMS,
      NotificationChannel.SLACK,
      NotificationChannel.EMAIL,
    ]);
  });

  it('forwards alert notifications in policy step order', async () => {
    const deliveries: string[] = [];
    service.setNotificationHandler((channel, _alert, level) => {
      deliveries.push(`${level}:${channel}`);
    });

    await service.routeAlert(
      {
        id: 'alert-2',
        source: 'api',
        severity: AlertSeverity.HIGH,
        message: 'Error budget burn',
      },
      {
        id: 'policy-1',
        minimumSeverity: AlertSeverity.MEDIUM,
        steps: [
          { level: 2, channels: [NotificationChannel.SMS], delaySeconds: 60 },
          { level: 1, channels: [NotificationChannel.SLACK], delaySeconds: 0 },
        ],
      },
    );

    expect(deliveries).toEqual([
      '1:slack',
      '2:sms',
    ]);
  });

  it('logs escalation actions for audit review', async () => {
    await service.routeAlert({
      id: 'alert-3',
      source: 'risk-engine',
      severity: AlertSeverity.MEDIUM,
      message: 'Risk threshold warning',
    });

    const auditTrail = service.getAuditTrail('alert-3');

    expect(auditTrail).toHaveLength(1);
    expect(auditTrail[0]).toMatchObject({
      alertId: 'alert-3',
      channel: NotificationChannel.SLACK,
      status: 'forwarded',
    });
  });
});
