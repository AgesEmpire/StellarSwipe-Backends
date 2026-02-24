import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SECURITY_EVENTS } from './monitoring/security-monitor.service';
import { SecurityAlert } from './entities/security-alert.entity';
import { SecurityIncident } from './entities/security-incident.entity';

/**
 * Security Event Listener
 *
 * Reacts to security events emitted by SecurityMonitorService.
 * Wire in your existing email, SMS, and user-locking services here.
 *
 * This keeps the monitor service decoupled from notification infrastructure.
 */
@Injectable()
export class SecurityEventListener {
  private readonly logger = new Logger(SecurityEventListener.name);

  // Inject your existing services:
  // constructor(
  //   private readonly emailService: EmailService,
  //   private readonly smsService: SmsService,
  //   private readonly usersService: UsersService,
  // ) {}

  @OnEvent(SECURITY_EVENTS.ACCOUNT_LOCKED)
  async handleAccountLocked(payload: {
    userId: string;
    reason: string;
    alertId: string;
    requires2FAReeset: boolean;
  }) {
    this.logger.warn(
      `Locking account for user ${payload.userId} - reason: ${payload.reason}`,
    );

    // TODO: call your UsersService
    // await this.usersService.lockAccount(payload.userId, payload.reason);
    //
    // if (payload.requires2FAReeset) {
    //   await this.usersService.invalidate2FA(payload.userId);
    // }
  }

  @OnEvent(SECURITY_EVENTS.ALERT_CREATED)
  async handleAlertCreated(payload: { alert: SecurityAlert }) {
    this.logger.debug(
      `Alert created: ${payload.alert.type} for user ${payload.alert.userId}`,
    );
    // Metrics / telemetry hook
  }

  @OnEvent(SECURITY_EVENTS.INCIDENT_CREATED)
  async handleIncidentCreated(payload: { incident: SecurityIncident }) {
    this.logger.warn(`Incident created: ${payload.incident.title}`);
    // Notify on-call / ops channel
  }

  @OnEvent('notification.security')
  async handleSecurityNotification(payload: {
    userId: string;
    level: string;
    alertType: string;
    alertId: string;
    details: Record<string, unknown>;
    timestamp: Date;
  }) {
    this.logger.log(
      `Sending ${payload.level} notification to user ${payload.userId}: ${payload.alertType}`,
    );

    // TODO: wire to your email/SMS services
    //
    // if (payload.level === 'CRITICAL') {
    //   await this.smsService.sendSecurityAlert(payload.userId, payload.alertType);
    //   await this.emailService.sendSecurityAlert(payload.userId, payload);
    // } else if (payload.level === 'WARNING') {
    //   await this.emailService.sendSecurityAlert(payload.userId, payload);
    // }
  }

  @OnEvent('security.require_2fa')
  async handleRequire2FA(payload: {
    userId: string;
    reason: string;
    alertId: string;
  }) {
    this.logger.log(
      `Requiring 2FA reset for user ${payload.userId}: ${payload.reason}`,
    );
    // TODO: await this.authService.invalidateSessionsRequire2FA(payload.userId);
  }
}
