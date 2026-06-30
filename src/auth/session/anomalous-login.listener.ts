import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SESSION_FINGERPRINT_EVENTS } from './session-fingerprint.service';
import { UsersService } from '../../users/users.service';
import { EmailService } from '../../email/email.service';

export interface AnomalousLoginEvent {
  userId: string;
  fingerprintHash: string;
  ipAddress?: string;
  userAgent?: string;
  occurredAt: Date;
}

/**
 * Reacts to SessionFingerprintService's anomalous-login event by
 * notifying the affected user via email. Kept as a separate listener
 * (rather than inlined in the fingerprint service) so the fingerprinting
 * logic stays decoupled from notification infrastructure.
 */
@Injectable()
export class AnomalousLoginListener {
  private readonly logger = new Logger(AnomalousLoginListener.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly emailService: EmailService,
  ) {}

  @OnEvent(SESSION_FINGERPRINT_EVENTS.ANOMALOUS_LOGIN)
  async handleAnomalousLogin(payload: AnomalousLoginEvent): Promise<void> {
    try {
      const user = await this.usersService.findById(payload.userId);
      if (!user?.email) {
        this.logger.debug(
          `Skipping anomalous-login email for user ${payload.userId}: no email on file`,
        );
        return;
      }

      await this.emailService.sendEmail({
        to: user.email,
        subject: 'Security Alert: New device sign-in',
        template: 'security-alert',
        variables: {
          alertType: 'New device sign-in',
          description:
            'We noticed a sign-in to your account from a device, network, or browser we have not seen recently. If this was you, no action is needed.',
          timestamp: payload.occurredAt.toISOString(),
          ipAddress: payload.ipAddress ?? 'unknown',
          link: 'https://app.stellarswipe.io/account/security',
        },
      });
    } catch (error) {
      // Notification failures must never break the login flow; this
      // listener runs decoupled from the request that triggered it.
      this.logger.error(
        `Failed to send anomalous-login notification for user ${payload.userId}: ${error?.message}`,
      );
    }
  }
}
