import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { KYC_EVENTS } from './kyc.service';
import { KycLevel } from './entities/kyc-verification.entity';

/**
 * KYC Event Listener
 *
 * Reacts to KYC lifecycle events emitted by KycService.
 * Wire your existing email, SMS, and user services here.
 */
@Injectable()
export class KycEventListener {
  private readonly logger = new Logger(KycEventListener.name);

  // Inject your services:
  // constructor(
  //   private readonly emailService: EmailService,
  //   private readonly smsService: SmsService,
  //   private readonly usersService: UsersService,
  //   private readonly notificationService: NotificationService,
  // ) {}

  @OnEvent(KYC_EVENTS.INITIATED)
  async handleKycInitiated(payload: {
    userId: string;
    level: KycLevel;
    verificationId: string;
  }) {
    this.logger.log(
      `KYC initiated for user ${payload.userId} - Level ${payload.level}`,
    );

    // TODO: send confirmation email
    // await this.emailService.sendKycStarted(payload.userId, payload.level);
  }

  @OnEvent(KYC_EVENTS.APPROVED)
  async handleKycApproved(payload: {
    userId: string;
    level: KycLevel;
    verificationId: string;
    expiresAt?: Date;
    manual?: boolean;
  }) {
    this.logger.log(
      `KYC Level ${payload.level} APPROVED for user ${payload.userId}`,
    );

    // TODO: notify the user and update their profile / permissions
    // await this.emailService.sendKycApproved(payload.userId, payload.level);
    // await this.usersService.setKycLevel(payload.userId, payload.level);
  }

  @OnEvent(KYC_EVENTS.REJECTED)
  async handleKycRejected(payload: {
    userId: string;
    level: KycLevel;
    reason: string;
  }) {
    this.logger.warn(
      `KYC REJECTED for user ${payload.userId}: ${payload.reason}`,
    );

    // TODO: notify the user with rejection reason and retry instructions
    // await this.emailService.sendKycRejected(payload.userId, payload.level, payload.reason);
  }

  @OnEvent(KYC_EVENTS.EXPIRED)
  async handleKycExpired(payload: {
    userId: string;
    level: KycLevel;
    verificationId: string;
  }) {
    this.logger.warn(
      `KYC Level ${payload.level} EXPIRED for user ${payload.userId}`,
    );

    // TODO: notify user to renew, downgrade their effective level
    // await this.emailService.sendKycExpired(payload.userId, payload.level);
    // await this.usersService.recalculateKycLevel(payload.userId);
  }

  @OnEvent(KYC_EVENTS.LEVEL_CHANGED)
  async handleLevelChanged(payload: { userId: string; newLevel: KycLevel }) {
    this.logger.log(
      `KYC level updated to ${payload.newLevel} for user ${payload.userId}`,
    );

    // TODO: update user record and unlock higher trading limits
    // await this.usersService.setKycLevel(payload.userId, payload.newLevel);
    // await this.tradesService.updateUserLimits(payload.userId, payload.newLevel);
  }
}
