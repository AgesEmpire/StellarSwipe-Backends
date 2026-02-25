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
      declinedReasons: result.declinedReasons,
      providerMetadata: result.providerMetadata,
    });
  }

  // ─── Core Result Application ──────────────────────────────────────────────

  private async applyVerificationResult(
    verification: KycVerification,
    result: {
      status: 'approved' | 'declined' | 'needs_review' | 'pending';
      verificationId: string;
      declinedReasons: string[];
      providerMetadata: Record<string, unknown>;
    },
  ): Promise<void> {
    const previousStatus = verification.status;

    const updates: Partial<KycVerification> = {
      verificationId: result.verificationId,
      providerMetadata: result.providerMetadata,
    };

    switch (result.status) {
      case 'approved':
        updates.status = KycStatus.APPROVED;
        updates.approvedAt = new Date();
        updates.expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
        updates.rejectionReason = null;
        break;

      case 'declined':
        updates.status = KycStatus.REJECTED;
        updates.rejectionReason =
          result.declinedReasons.join('; ') || 'Verification declined';
        break;

      case 'needs_review':
        updates.status = KycStatus.UNDER_REVIEW;
        break;

      case 'pending':
        updates.status = KycStatus.PENDING;
        break;
    }

    await this.kycRepo.update(verification.id, updates);

    const updated = { ...verification, ...updates };

    await this.audit(
      verification.userId,
      verification.id,
      KycAuditAction.STATUS_CHANGED,
      {
        from: previousStatus,
        to: updates.status,
        verificationId: result.verificationId,
      },
    );

    // Emit events for downstream consumers
    if (updates.status === KycStatus.APPROVED) {
      this.logger.log(
        `KYC Level ${verification.level} APPROVED for user ${verification.userId}`,
      );
      this.eventEmitter.emit(KYC_EVENTS.APPROVED, {
        userId: verification.userId,
        level: verification.level,
        verificationId: verification.id,
        expiresAt: updates.expiresAt,
      });
      this.eventEmitter.emit(KYC_EVENTS.LEVEL_CHANGED, {
        userId: verification.userId,
        newLevel: verification.level,
      });
    } else if (updates.status === KycStatus.REJECTED) {
      this.logger.warn(
        `KYC REJECTED for user ${verification.userId}: ${updates.rejectionReason}`,
      );
      this.eventEmitter.emit(KYC_EVENTS.REJECTED, {
        userId: verification.userId,
        level: verification.level,
        reason: updates.rejectionReason,
      });
    }
  }

  // ─── Manual Review ────────────────────────────────────────────────────────

  async manualReview(
    verificationId: string,
    dto: ManualReviewDto,
    ipAddress?: string,
  ): Promise<KycVerification> {
    const verification = await this.kycRepo.findOneOrFail({
      where: { id: verificationId },
    });

    const updates: Partial<KycVerification> = { status: dto.status };
    if (dto.status === KycStatus.APPROVED) {
      updates.approvedAt = new Date();
      updates.expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
    }
    if (dto.notes) updates.rejectionReason = dto.notes;

    await this.kycRepo.update(verificationId, updates);
    await this.audit(
      verification.userId,
      verificationId,
      KycAuditAction.STATUS_CHANGED,
      {
        reviewedBy: dto.reviewedBy,
        status: dto.status,
        notes: dto.notes,
        manual: true,
      },
      ipAddress,
    );

    if (dto.status === KycStatus.APPROVED) {
      this.eventEmitter.emit(KYC_EVENTS.APPROVED, {
        userId: verification.userId,
        level: verification.level,
        verificationId,
        manual: true,
      });
    }

    return { ...verification, ...updates };
  }

  // ─── Status Query ─────────────────────────────────────────────────────────

  async getUserKycStatus(userId: string): Promise<KycStatusDto[]> {
    const records = await this.kycRepo.find({
      where: { userId },
      order: { level: 'DESC', createdAt: 'DESC' },
    });
    return records as KycStatusDto[];
  }

  async getActiveKycLevel(userId: string): Promise<KycLevel> {
    const approved = await this.kycRepo.find({
      where: { userId, status: KycStatus.APPROVED },
      order: { level: 'DESC' },
    });

    // Find highest approved, non-expired level
    for (const v of approved) {
      if (!v.expiresAt || v.expiresAt > new Date()) {
        return v.level;
      }
    }

    return KycLevel.NONE;
  }

  // ─── Limit Enforcement ────────────────────────────────────────────────────

  async checkMonthlyLimit(
    userId: string,
    requestedAmountUsd: number,
  ): Promise<KycLimitDto> {
    const level = await this.getActiveKycLevel(userId);
    const monthlyLimit = KYC_MONTHLY_LIMITS[level];

    // Usage tracking — your trades/transactions service should call this
    // and pass the real current month usage. Using 0 as placeholder.
    const currentMonthUsageUsd = await this.getCurrentMonthUsage(userId);

    const remaining =
      monthlyLimit === null ? null : monthlyLimit - currentMonthUsageUsd;
    const isLimitReached =
      monthlyLimit !== null &&
      currentMonthUsageUsd + requestedAmountUsd > monthlyLimit;

    await this.audit(
      userId,
      null,
      isLimitReached
        ? KycAuditAction.LIMIT_EXCEEDED
        : KycAuditAction.LIMIT_CHECKED,
      {
        level,
        monthlyLimit,
        currentUsage: currentMonthUsageUsd,
        requested: requestedAmountUsd,
      },
    );

    if (isLimitReached) {
      throw new ForbiddenException(
        `Monthly limit of $${monthlyLimit?.toLocaleString()} reached. Upgrade your KYC level to continue.`,
      );
    }

    return {
      level,
      monthlyLimitUsd: monthlyLimit,
      currentMonthUsageUsd,
      remainingUsd: remaining,
      isLimitReached: false,
    };
  }

  // ─── Expiry Management (scheduled job) ───────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async expireVerifications(): Promise<void> {
    const expired = await this.kycRepo.find({
      where: {
        status: KycStatus.APPROVED,
        expiresAt: LessThan(new Date()),
      },
    });

    for (const v of expired) {
      await this.kycRepo.update(v.id, { status: KycStatus.EXPIRED });
      await this.audit(v.userId, v.id, KycAuditAction.EXPIRED, {
        expiredAt: v.expiresAt,
        level: v.level,
      });
      this.eventEmitter.emit(KYC_EVENTS.EXPIRED, {
        userId: v.userId,
        level: v.level,
        verificationId: v.id,
      });
      this.logger.log(
        `KYC verification expired for user ${v.userId}, level ${v.level}`,
      );
    }

    if (expired.length > 0) {
      this.logger.log(`Expired ${expired.length} KYC verifications`);
    }
  }

  // ─── Compliance Report ────────────────────────────────────────────────────

  async generateComplianceReport(): Promise<ComplianceReportDto> {
    const [total, approved, pending, rejected, expired] = await Promise.all([
      this.kycRepo.count(),
      this.kycRepo.count({ where: { status: KycStatus.APPROVED } }),
      this.kycRepo.count({ where: { status: KycStatus.PENDING } }),
      this.kycRepo.count({ where: { status: KycStatus.REJECTED } }),
      this.kycRepo.count({ where: { status: KycStatus.EXPIRED } }),
    ]);

    const byLevel = await this.kycRepo
      .createQueryBuilder('k')
      .select('k.level', 'level')
      .addSelect('COUNT(*)', 'count')
      .where('k.status = :status', { status: KycStatus.APPROVED })
      .groupBy('k.level')
      .getRawMany();

    const byProvider = await this.kycRepo
      .createQueryBuilder('k')
      .select('k.provider', 'provider')
      .addSelect('COUNT(*)', 'count')
      .groupBy('k.provider')
      .getRawMany();

    // Verifications expiring in the next 30 days
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const renewalsDue = await this.kycRepo.count({
      where: {
        status: KycStatus.APPROVED,
        expiresAt: LessThan(thirtyDaysFromNow),
      },
    });

    return {
      reportDate: new Date(),
      totalVerifications: total,
      approved,
      pending,
      rejected,
      expired,
      byLevel: Object.fromEntries(
        byLevel.map((r) => [`level_${r.level}`, parseInt(r.count, 10)]),
      ),
      byProvider: Object.fromEntries(
        byProvider.map((r) => [r.provider, parseInt(r.count, 10)]),
      ),
      renewalsDue,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

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

  /**
   * Calculate current month's transaction volume for the user.
   *
   * TODO: inject your TradesService or TransactionsService and sum
   * the actual USD volume for the current calendar month.
   * Returning 0 as a placeholder until integrated.
   */
  private async getCurrentMonthUsage(userId: string): Promise<number> {
    return 0;
  }

  private async audit(
    userId: string,
    verificationId: string | null,
    action: KycAuditAction,
    details: Record<string, unknown>,
    ipAddress?: string,
  ): Promise<void> {
    try {
      await this.auditRepo.save(
        this.auditRepo.create({
          userId,
          verificationId,
          action,
          details,
          ipAddress: ipAddress ?? null,
        }),
      );
    } catch (err) {
      this.logger.error(`KYC audit log failed: ${(err as Error).message}`);
    }
  }
}
