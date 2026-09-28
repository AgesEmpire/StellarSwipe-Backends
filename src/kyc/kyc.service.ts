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

/**
 * Numeric ordering of KYC levels. Used to enforce monotonic upgrades so that
 * stale or out-of-order approval events can never lower (or accidentally
 * raise) a user's effective verification level.
 */
const LEVEL_RANK: Record<KycLevel, number> = {
  [KycLevel.NONE]: 0,
  [KycLevel.BASIC]: 1,
  [KycLevel.ENHANCED]: 2,
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

  // ─── Approval Handling ────────────────────────────────────────────────────

  /**
   * Handle a KYC approval event.
   *
   * Persists the approved verification, then applies the corresponding
   * effective trading limits. The upgrade is monotonic: a stale or
   * out-of-order approval for a lower tier never lowers (or re-raises) the
   * user's effective level, and duplicate approvals are idempotent.
   */
  async handleVerificationApproved(
    verificationId: string,
    approvedLevel?: KycLevel,
  ): Promise<void> {
    const verification = await this.kycRepo.findOne({
      where: { id: verificationId },
    });

    if (!verification) {
      this.logger.warn(
        `Approval event for unknown verification ${verificationId} — ignoring`,
      );
      return;
    }

    // Idempotency: an already-approved verification is a no-op so duplicate
    // approval events do not re-apply limits or re-emit notifications.
    if (verification.status === KycStatus.APPROVED) {
      this.logger.debug(
        `Ignoring duplicate approval for verification ${verificationId}`,
      );
      return;
    }

    // Only a pending verification can be approved. Rejected/expired records
    // must not be resurrected by a late approval event.
    if (verification.status !== KycStatus.PENDING) {
      this.logger.debug(
        `Ignoring approval for verification ${verificationId} in status ${verification.status}`,
      );
      return;
    }

    // Reject unknown levels and downgrades. The approved level must be a known
    // tier and must not be lower than the level the verification was created
    // for.
    const level = approvedLevel ?? verification.level;
    if (LEVEL_RANK[level] === undefined) {
      this.logger.warn(
        `Ignoring approval for verification ${verificationId} with unknown level ${level}`,
      );
      return;
    }
    if (LEVEL_RANK[level] < LEVEL_RANK[verification.level]) {
      this.logger.warn(
        `Ignoring downgrade approval for verification ${verificationId}: ${verification.level} -> ${level}`,
      );
      return;
    }

    const previousStatus = verification.status;
    const now = new Date();

    await this.kycRepo.update(verification.id, {
      status: KycStatus.APPROVED,
      level,
      approvedAt: now,
      expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
    });

    await this.audit(
      verification.userId,
      verification.id,
      KycAuditAction.APPROVED,
      { level, previousStatus, previousLevel: verification.level },
    );

    // Apply the effective trading limits for the (possibly upgraded) level.
    await this.applyApprovedLimits(verification.userId, level);

    this.eventEmitter.emit(KYC_EVENTS.APPROVED, {
      userId: verification.userId,
      level,
      verificationId: verification.id,
    });
  }

  /**
   * Recompute and apply the effective trading limits for a user's approved
   * KYC level. Limits are monotonic: an upgrade may only raise limits, and a
   * stale event for a lower tier never reduces limits already granted.
   */
  private async applyApprovedLimits(
    userId: string,
    level: KycLevel,
  ): Promise<void> {
    const effectiveLevel = await this.getEffectiveLevel(userId);

    // Never apply limits for a level lower than the user's current effective
    // level — this guards against stale/out-of-order approval events.
    if (LEVEL_RANK[level] < LEVEL_RANK[effectiveLevel]) {
      this.logger.debug(
        `Skipping limit application for user ${userId}: level ${level} below effective ${effectiveLevel}`,
      );
      return;
    }

    const limits = KYC_MONTHLY_LIMITS[level];

    this.eventEmitter.emit(KYC_EVENTS.LEVEL_CHANGED, {
      userId,
      level,
      limits,
    });
  }

  /**
   * Resolve the user's current effective KYC level from their approved
   * verifications. Returns NONE when the user has no active approval.
   */
  private async getEffectiveLevel(userId: string): Promise<KycLevel> {
    const approved = await this.kycRepo.find({
      where: { userId, status: KycStatus.APPROVED },
    });

    return approved.reduce<KycLevel>((highest, v) => {
      return LEVEL_RANK[v.level] > LEVEL_RANK[highest] ? v.level : highest;
    }, KycLevel.NONE);
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
   * Emitted as a dedicated event so downstream modules can react.
   */
  private async applyExpiryRestrictions(
    verification: KycVerification,
  ): Promise<void> {
    this.eventEmitter.emit(KYC_EVENTS.LEVEL_CHANGED, {
      userId: verification.userId,
      level: KycLevel.NONE,
      limits: KYC_MONTHLY_LIMITS[KycLevel.NONE],
      reason: 'verification_expired',
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async getApprovedVerification(
    userId: string,
    level: KycLevel,
  ): Promise<KycVerification | null> {
    return this.kycRepo.findOne({
      where: { userId, level, status: KycStatus.APPROVED },
    });
  }

  private async getAttemptCount(
    userId: string,
    level: KycLevel,
  ): Promise<number> {
    return this.kycRepo.count({ where: { userId, level } });
  }

  private async audit(
    userId: string,
    verificationId: string,
    action: KycAuditAction,
    metadata: Record<string, unknown>,
    ipAddress?: string,
  ): Promise<void> {
    await this.auditRepo.save(
      this.auditRepo.create({
        userId,
        verificationId,
        action,
        metadata,
        ipAddress,
      }),
    );
  }
}
