import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { KYC_EVENTS } from './kyc.service';
import { KycLevel } from './entities/kyc-verification.entity';
import { NotificationService } from '../notifications/notification.service';
import { SendNotificationDto } from '../notifications/dto/send-notification.dto';
import { NotificationChannel, NotificationType } from '../notifications/entities/notification.entity';

export type KycLocale = 'en' | 'es' | 'fr';

/** Approved rejection reason codes that are safe to show applicants. */
export enum KycRejectionCode {
  DOCUMENT_UNREADABLE = 'DOCUMENT_UNREADABLE',
  DOCUMENT_EXPIRED = 'DOCUMENT_EXPIRED',
  IDENTITY_MISMATCH = 'IDENTITY_MISMATCH',
  SELFIE_MISMATCH = 'SELFIE_MISMATCH',
  UNSUPPORTED_DOCUMENT = 'UNSUPPORTED_DOCUMENT',
  UNSPECIFIED = 'UNSPECIFIED',
}

const REJECTION_MESSAGES: Record<KycLocale, Record<KycRejectionCode, string>> = {
  en: {
    DOCUMENT_UNREADABLE: 'We could not read your document. Upload a clear, well-lit photo showing all corners.',
    DOCUMENT_EXPIRED: 'Your document has expired. Please submit a valid, unexpired document.',
    IDENTITY_MISMATCH: 'Your details did not match your document. Check your name and date of birth, then resubmit.',
    SELFIE_MISMATCH: 'Your selfie did not match your document photo. Retake it in good lighting without glasses or hats.',
    UNSUPPORTED_DOCUMENT: 'This document type is not supported. Use a passport, national ID card, or driver\'s license.',
    UNSPECIFIED: 'Your verification could not be completed. Please review your information and submit again.',
  },
  es: {
    DOCUMENT_UNREADABLE: 'No pudimos leer tu documento. Sube una foto clara y bien iluminada que muestre todas las esquinas.',
    DOCUMENT_EXPIRED: 'Tu documento ha caducado. Envía un documento válido y vigente.',
    IDENTITY_MISMATCH: 'Tus datos no coinciden con tu documento. Revisa tu nombre y fecha de nacimiento y vuelve a enviarlo.',
    SELFIE_MISMATCH: 'Tu selfie no coincide con la foto del documento. Vuelve a tomarla con buena luz y sin gafas ni gorra.',
    UNSUPPORTED_DOCUMENT: 'Este tipo de documento no es compatible. Usa pasaporte, documento nacional o licencia de conducir.',
    UNSPECIFIED: 'No se pudo completar tu verificación. Revisa tu información y envíala de nuevo.',
  },
  fr: {
    DOCUMENT_UNREADABLE: 'Nous n\'avons pas pu lire votre document. Envoyez une photo nette et bien éclairée montrant tous les coins.',
    DOCUMENT_EXPIRED: 'Votre document a expiré. Veuillez soumettre un document valide.',
    IDENTITY_MISMATCH: 'Vos informations ne correspondent pas à votre document. Vérifiez votre nom et date de naissance, puis réessayez.',
    SELFIE_MISMATCH: 'Votre selfie ne correspond pas à la photo du document. Reprenez-le avec un bon éclairage, sans lunettes ni chapeau.',
    UNSUPPORTED_DOCUMENT: 'Ce type de document n\'est pas accepté. Utilisez un passeport, une carte d\'identité ou un permis de conduire.',
    UNSPECIFIED: 'Votre vérification n\'a pas pu aboutir. Vérifiez vos informations et soumettez-les à nouveau.',
  },
};

const SUBMISSION_MESSAGES: Record<KycLocale, { title: string; message: string }> = {
  en: { title: 'Verification submitted', message: 'We received your verification and it is now under review. We will notify you once it is complete.' },
  es: { title: 'Verificación enviada', message: 'Recibimos tu verificación y está en revisión. Te avisaremos cuando finalice.' },
  fr: { title: 'Vérification envoyée', message: 'Nous avons reçu votre vérification, elle est en cours d\'examen. Nous vous informerons dès qu\'elle sera terminée.' },
};

const REJECTION_TITLES: Record<KycLocale, string> = {
  en: 'Verification unsuccessful',
  es: 'Verificación no completada',
  fr: 'Vérification non aboutie',
};

const DELIVERY_ATTEMPTS = 3;
const MAX_DEDUPE_KEYS = 10_000;

/** Maps a raw (possibly internal/free-text) reason to an approved code. */
export function toRejectionCode(reason?: string | null): KycRejectionCode {
  const code = (reason ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return (Object.values(KycRejectionCode) as string[]).includes(code)
    ? (code as KycRejectionCode)
    : KycRejectionCode.UNSPECIFIED;
}

function resolveLocale(locale?: string): KycLocale {
  const base = (locale ?? 'en').slice(0, 2).toLowerCase();
  return base in REJECTION_MESSAGES ? (base as KycLocale) : 'en';
}

/**
 * KYC Event Listener
 *
 * Reacts to KYC lifecycle events emitted by KycService.
 * Wire your existing email, SMS, and user services here.
 */
@Injectable()
export class KycEventListener {
  private readonly logger = new Logger(KycEventListener.name);
  private readonly processed = new Set<string>();
  /** Notifications that exhausted retries; kept so the KYC event is not lost. */
  readonly failedDeliveries: SendNotificationDto[] = [];

  constructor(@Optional() private readonly notificationService?: NotificationService) {}

  @OnEvent(KYC_EVENTS.INITIATED)
  async handleKycInitiated(payload: {
    userId: string;
    level: KycLevel;
    verificationId: string;
    locale?: string;
  }) {
    this.logger.log(
      `KYC initiated for user ${payload.userId} - Level ${payload.level}`,
    );

    if (!payload.userId || !payload.verificationId) return;
    if (!this.markProcessed(`submitted:${payload.verificationId}`)) return;

    const text = SUBMISSION_MESSAGES[resolveLocale(payload.locale)];
    await this.deliver({
      userId: payload.userId,
      type: NotificationType.KYC_SUBMITTED,
      title: text.title,
      message: text.message,
      channel: NotificationChannel.IN_APP,
      metadata: { verificationId: payload.verificationId, level: payload.level },
    });
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
    reason?: string;
    verificationId?: string;
    locale?: string;
  }) {
    const code = toRejectionCode(payload.reason);
    // Raw reason may contain reviewer notes or document data - log the code only.
    this.logger.warn(`KYC REJECTED for user ${payload.userId}: ${code}`);

    const dedupeKey = `rejected:${payload.verificationId ?? `${payload.userId}:${payload.level}`}`;
    if (!this.markProcessed(dedupeKey)) return;

    const locale = resolveLocale(payload.locale);
    await this.deliver({
      userId: payload.userId,
      type: NotificationType.KYC_REJECTED,
      title: REJECTION_TITLES[locale],
      message: REJECTION_MESSAGES[locale][code],
      channel: NotificationChannel.IN_APP,
      metadata: { reasonCode: code, level: payload.level, canRetry: true },
    });
  }

  /** Returns false if the key was already handled (duplicate event). */
  private markProcessed(key: string): boolean {
    if (this.processed.has(key)) {
      this.logger.debug(`Skipping duplicate KYC event ${key}`);
      return false;
    }
    this.processed.add(key);
    if (this.processed.size > MAX_DEDUPE_KEYS) {
      this.processed.delete(this.processed.values().next().value as string);
    }
    return true;
  }

  /** Sends with retries; on exhaustion records the failure instead of throwing. */
  private async deliver(dto: SendNotificationDto): Promise<boolean> {
    if (!this.notificationService) return false;
    for (let attempt = 1; attempt <= DELIVERY_ATTEMPTS; attempt++) {
      try {
        await this.notificationService.send(dto);
        return true;
      } catch (error) {
        this.logger.warn(
          `KYC notification ${dto.type} attempt ${attempt}/${DELIVERY_ATTEMPTS} failed for user ${dto.userId}: ${(error as Error).message}`,
        );
      }
    }
    this.failedDeliveries.push(dto);
    this.logger.error(`KYC notification ${dto.type} recorded as undelivered for user ${dto.userId}`);
    return false;
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
