import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../notifications/email.service';
import { SmsService } from '../notifications/sms.service';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { SecurityEvent, SecurityEventType, SecurityEventSeverity } from './security-event.entity';

const HIGH_RISK_EVENTS: SecurityEventType[] = [
  SecurityEventType.PASSWORD_CHANGED,
  SecurityEventType.MFA_DISABLED,
  SecurityEventType.SUSPICIOUS_LOGIN,
  SecurityEventType.ACCOUNT_LOCKED,
  SecurityEventType.EMAIL_CHANGED,
];

@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger(SecurityEventsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly notificationPreferencesService: NotificationPreferencesService,
  ) {}

  async recordEvent(event: SecurityEvent): Promise<void> {
    if (!this.isEligible(event)) {
      return;
    }

    const preferences = await this.notificationPreferencesService.getForUser(event.userId);
    const channels = this.resolveChannels(preferences);

    if (channels.length === 0) {
      this.logger.debug(`No enabled channels for security event ${event.type} (user ${event.userId})`);
      return;
    }

    const message = this.buildRedactedMessage(event);

    await Promise.all(
      channels.map((channel) => this.deliver(channel, event, message)),
    );
  }

  private isEligible(event: SecurityEvent): boolean {
    if (event.severity !== SecurityEventSeverity.HIGH) {
      return false;
    }
    return HIGH_RISK_EVENTS.includes(event.type);
  }

  private resolveChannels(preferences: { emailEnabled: boolean; smsEnabled: boolean }): Array<'email' | 'sms'> {
    const channels: Array<'email' | 'sms'> = [];
    if (preferences.emailEnabled) {
      channels.push('email');
    }
    if (preferences.smsEnabled) {
      channels.push('sms');
    }
    return channels;
  }

  private async deliver(
    channel: 'email' | 'sms',
    event: SecurityEvent,
    message: { subject: string; body: string },
  ): Promise<void> {
    try {
      if (channel === 'email') {
        await this.emailService.send({
          to: event.userEmail,
          subject: message.subject,
          body: message.body,
        });
      } else {
        await this.smsService.send({
          to: event.userPhone,
          body: message.body,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to deliver security alert via ${channel} for event ${event.type} (user ${event.userId})`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private buildRedactedMessage(event: SecurityEvent): { subject: string; body: string } {
    const subject = `Security alert: ${event.type}`;
    const body = [
      `A high-risk security event was detected on your account.`,
      `Event: ${event.type}`,
      `Time: ${event.createdAt.toISOString()}`,
      `If this was not you, please secure your account immediately.`,
    ].join('\n');
    return { subject, body };
  }
}
