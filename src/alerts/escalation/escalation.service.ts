import { Injectable, Logger } from '@nestjs/common';
import { AlertRuleDto } from './dto/alert-rule.dto';
import { EscalationPolicyDto, NotificationChannel } from './dto/escalation-policy.dto';
import { routeByPriority } from './utils/priority-router';

export interface EscalationAuditEntry {
  alertId: string;
  source: string;
  severity: string;
  escalationLevel: number;
  channel: NotificationChannel;
  status: 'forwarded';
  forwardedAt: Date;
  policyId?: string;
}

export interface EscalationResult {
  alertId: string;
  escalationLevel: number;
  forwardedChannels: NotificationChannel[];
  auditEntries: EscalationAuditEntry[];
}

type NotificationHandler = (
  channel: NotificationChannel,
  alert: AlertRuleDto,
  level: number,
) => Promise<void> | void;

@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);
  private readonly auditTrail: EscalationAuditEntry[] = [];
  private notificationHandler: NotificationHandler = () => undefined;

  setNotificationHandler(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  async routeAlert(
    alert: AlertRuleDto,
    policy?: EscalationPolicyDto,
  ): Promise<EscalationResult> {
    const routed = routeByPriority(alert.severity, policy);
    const auditEntries: EscalationAuditEntry[] = [];
    const forwardedChannels: NotificationChannel[] = [];

    for (const step of routed.steps) {
      for (const channel of step.channels) {
        await this.notificationHandler(channel, alert, step.level);
        forwardedChannels.push(channel);

        const entry: EscalationAuditEntry = {
          alertId: alert.id,
          source: alert.source,
          severity: alert.severity,
          escalationLevel: step.level,
          channel,
          status: 'forwarded',
          forwardedAt: new Date(),
          policyId: policy?.id,
        };

        this.auditTrail.push(entry);
        auditEntries.push(entry);
        this.logger.warn(
          `Escalated alert ${alert.id} to ${channel} at level ${step.level}`,
        );
      }
    }

    return {
      alertId: alert.id,
      escalationLevel: routed.escalationLevel,
      forwardedChannels,
      auditEntries,
    };
  }

  getAuditTrail(alertId?: string): EscalationAuditEntry[] {
    const entries = alertId
      ? this.auditTrail.filter((entry) => entry.alertId === alertId)
      : this.auditTrail;

    return [...entries];
  }

  clearAuditTrail(): void {
    this.auditTrail.length = 0;
  }
}
