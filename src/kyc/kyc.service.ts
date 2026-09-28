import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  KycVerification,
  KycStatus,
  KycLevel,
  KycProvider,
  KYC_MONTHLY_LIMITS,
} from './entities/kyc-verification.entity';
import { KycAuditLog, KycAuditAction } from './entities/kyc-audit-log.entity';
import { PersonaProvider } from './providers/persona.provider';
import { OnfidoProvider } from './providers/onfido.provider';
import {
  StartKycDto,
  StartKycResponseDto,
  KycStatusDto,
  KycLimitDto,
  ManualReviewDto,
  ComplianceReportDto,
} from './dto/start-kyc.dto';

export const KYC_EVENTS = {
  INITIATED: 'kyc.initiated',
  APPROVED: 'kyc.approved',
  REJECTED: 'kyc.rejected',
  EXPIRED: 'kyc.expired',
  LEVEL_CHANGED: 'kyc.level_changed',
};

/** 1 year in milliseconds */
const VERIFICATION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** Levels that require Level 1 to be approved before starting Level 2 */
const LEVEL_PREREQUISITES: Record<KycLevel, KycLevel | null> = {
  [KycLevel.NONE]: null,
  [KycLevel.BASIC]: null,
  [KycLevel.ENHANCED]: KycLevel.BASIC,
};

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    @InjectRepository(KycVerification)
    private readonly kycRepo: Repository<KycVerification>,
    @InjectRepository(KycAuditLog)
    private readonly auditRepo: Repository<KycAuditLog>,
    private readonly persona: PersonaProvider,
    private readonly onfido: OnfidoProvider,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Initiate KYC ─────────────────────────────────────────────────────────

  async startKyc(
    userId: string,
    dto: StartKycDto,
    ipAddress?: string,
  ): Promise<StartKycResponseDto> {
    if (dto.targetLevel === KycLevel.NONE) {
      throw new BadRequestException('Cannot initiate KYC for level 0');
    }

    // Check prerequisite: Level 2 requires approved Level 1
    const prereq = LEVEL_PREREQUISITES[dto.targetLevel];
    if (prereq !== null) {
      const prereqVerification = await this.getApprovedVerification(
        userId,
        prereq,
      );
      if (!prereqVerification) {
        throw new BadRequestException(
          `Level ${dto.targetLevel} KYC requires an approved Level ${prereq} verification first`,
        );
      }
    }

    // Check for existing active/pending verification at this level
    const existing = await this.kycRepo.findOne({
      where: { userId, level: dto.targetLevel, status: KycStatus.PENDING },
    });
    if (existing?.inquiryId) {
      // Resume instead of creating a new inquiry
      return this.resumeKyc(existing);
    }

    const provider = dto.provider ?? KycProvider.PERSONA;

    // Create verification record first
    const attempt = await this.getAttemptCount(userId, dto.targetLevel);
    const verification = await this.kycRepo.save(
      this.kycRepo.create({
        userId,
        level: dto.targetLevel,
        status: KycStatus.PENDING,
        provider,
        attemptCount: attempt + 1,
      }),
    );

    try {
      let response: StartKycResponseDto;

      if (provider === KycProvider.PERSONA) {
        const session = await this.persona.createInquiry(
          userId,
          dto.targetLevel,
          dto.redirectUrl,
        );
        await this.kycRepo.update(verification.id, {
          inquiryId: session.inquiryId,
          sessionToken: session.sessionToken,
        });
        response = {
          verificationRecordId: verification.id,
          inquiryId: session.inquiryId,
          sessionToken: session.sessionToken,
          widgetUrl: session.widgetUrl,
        };
      } else {
        // Onfido
        const session = await this.onfido.createApplicantSession(userId);
        await this.kycRepo.update(verification.id, {
          inquiryId: session.workflowRunId,
          sessionToken: session.sdkToken,
          verificationId: session.applicantId,
        });
        response = {
          verificationRecordId: verification.id,
          inquiryId: session.workflowRunId,
          sessionToken: session.sdkToken,
          widgetUrl: '', // Onfido uses native SDK, not a URL
        };
      }

      await this.audit(
        userId,
        verification.id,
        KycAuditAction.INITIATED,
        {
          level: dto.targetLevel,
          provider,
          attemptCount: attempt + 1,
        },
        ipAddress,
      );

      this.eventEmitter.emit(KYC_EVENTS.INITIATED, {
        userId,
        level: dto.targetLevel,
        verificationId: verification.id,
      });

      return response;
    } catch (err) {
      // Clean up the record if provider creation failed
      await this.kycRepo.delete(verification.id);
      throw err;
    }
  }

  // ─── Resume Pending Verification ──────────────────────────────────────────

  private async resumeKyc(
    verification: KycVerification,
  ): Promise<StartKycResponseDto> {
    if (!verification.inquiryId)
      throw new BadRequestException('No active inquiry to resume');

    const sessionToken = await this.persona.resumeInquiry(
      verification.inquiryId,
    );
    await this.kycRepo.update(verification.id, { sessionToken });

    return {
      verificationRecordId: verification.id,
      inquiryId: verification.inquiryId,
      sessionToken,
      widgetUrl: `https://withpersona.com/verify?inquiry-id=${verification.inquiryId}&session-token=${sessionToken}`,
    };
  }

  // ─── Expiry Handling ──────────────────────────────────────────────────────

  /**
   * Handle a KYC verification expiry event.
   *
   * Transitions the verification to EXPIRED, applies the resulting account
   * restrictions, and notifies the affected user exactly once. Replayed
   * events are idempotent: if the verification is already expired (or no
   * longer approved) the handler is a no-op.
   */
  async handleVerificationExpired(
    verificationId: string,
    reason = 'verification_expired',
  ): Promise<void> {
    const verification = await this.kycRepo.findOne({
      where: { id: verificationId },
    });

    if (!verification) {
      this.logger.warn(
        `Expiry event for unknown verification ${verificationId} — ignoring`,
      );
      return;
    }

    // Idempotency: only an APPROVED verification can expire. Replayed events
    // (already EXPIRED) or events for non-approved records are ignored so the
    // status change and notification fire exactly once.
    if (verification.status !== KycStatus.APPROVED) {
      this.logger.debug(
        `Ignoring expiry for verification ${verificationId} in status ${verification.status}`,
      );
      return;
    }

    const previousStatus = verification.status;

    await this.kycRepo.update(verification.id, {
      status: KycStatus.EXPIRED,
      expiredAt: new Date(),
    });

    await this.audit(
      verification.userId,
      verification.id,
      KycAuditAction.EXPIRED,
      { reason, previousStatus, level: verification.level },
    );

    // Apply account restrictions consistently with the expired status.
    await this.applyExpiryRestrictions(verification);

    // Notify the user once. Notification failures must not roll back the
    // status transition or restrictions already applied.
    try {
      this.eventEmitter.emit(KYC_EVENTS.EXPIRED, {
        userId: verification.userId,
        level: verification.level,
        verificationId: verification.id,
        reason,
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify user ${verification.userId} of KYC expiry: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Apply the account restrictions that follow from an expired verification.
   * Emitted as a dedicated event so downstream modules (limits, withdrawals,
   * etc.) can react consistently without this service knowing their internals.
   */
  private async applyExpiryRestrictions(
    verification: KycVerification,
  ): Promise<void> {
    this.eventEmitter.emit(KYC_EVENTS.LEVEL_CHANGED, {
      userId: verification.userId,
      previousLevel: verification.level,
      newLevel: KycLevel.NONE,
      reason: 'verification_expired',
    });
  }

  // ─── Webhook Processing ───────────────────────────────────────────────────

  async processPersonaWebhook(
    rawBody: string,
    signature: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.persona.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn('Invalid Persona webhook signature — rejecting');
      throw new BadRequestException('Invalid webhook signature');
    }

    const result = this.persona.parseWebhookPayload(payload);

    await this.audit(
      result.referenceId ?? 'unknown',
      null,
      KycAuditAction.WEBHOOK_RECEIVED,
      {
        provider: 'persona',
        inquiryId: result.inquiryId,
        status: result.status,
      },
    );

    const verification = await this.kycRepo.findOne({
      where: { inquiryId: result.inquiryId },
    });

    if (!verification) {
      this.logger.warn(
        `No verification found for Persona inquiry ${result.inquiryId}`,
      );
      return;
    }

    await this.applyVerificationResult(verification, {
      status: result.status,
      verificationId: result.verificationId,
      declinedReasons: result.declinedReasons,
      providerMetadata: result.providerMetadata,
    });
  }

  async processOnfidoWebhook(
    rawBody: string,
    signature: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.onfido.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn('Invalid Onfido webhook signature — rejecting');
      throw new BadRequestException('Invalid webhook signature');
    }

    const result = this.onfido.parseWebhookPayload(payload);

    const verification = await this.kycRepo.findOne({
      where: { inquiryId: result.workflowRunId },
    });

    if (!verification) {
      this.logger.warn(
        `No verification found for Onfido workflow run ${result.workflowRunId}`,
      );
      return;
    }

    await this.audit(
      verification.userId,
      verification.id,
      KycAuditAction.WEBHOOK_RECEIVED,
      {
        provider: 'onfido',
        workflowRunId: result.workflowRunId,
        status: result.status,
      },
    );

    await this.applyVerificationResult(verification, {
      status: result.status,
      verificationId: result.checkId,
      declinedReasons: result.declined

/* … truncated 9830 chars — edit only what you need near the top … */
