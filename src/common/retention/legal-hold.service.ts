import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LegalHold } from './legal-hold.entity';
import { RetentionService } from './retention.service';

/** Role names allowed to create, update or release legal holds. */
export const LEGAL_HOLD_ROLES = ['compliance'];

export interface LegalHoldActor {
  userId: string;
  tenantId: string;
  roles: string[];
}

export interface CreateLegalHoldInput {
  policyName: string;
  recordId?: string | null;
  reason: string;
  expiresAt?: Date | null;
}

export interface UpdateLegalHoldInput {
  reason?: string;
  expiresAt?: Date | null;
}

@Injectable()
export class LegalHoldService {
  private readonly logger = new Logger(LegalHoldService.name);

  constructor(
    @InjectRepository(LegalHold) private readonly holds: Repository<LegalHold>,
    private readonly retention: RetentionService,
  ) {}

  async createHold(actor: LegalHoldActor, input: CreateLegalHoldInput): Promise<LegalHold> {
    this.assertAuthorized(actor);
    if (!this.retention.getPolicies().some((p) => p.name === input.policyName)) {
      throw new BadRequestException(`Unknown retention policy "${input.policyName}"`);
    }
    const hold = this.holds.create({
      tenantId: actor.tenantId,
      policyName: input.policyName,
      recordId: input.recordId ?? null,
      reason: this.requireReason(input.reason),
      createdBy: actor.userId,
      expiresAt: this.requireFutureOrNull(input.expiresAt),
    });
    const saved = await this.holds.save(hold);
    this.logger.log(`Legal hold ${saved.id} created by ${actor.userId} (tenant ${actor.tenantId}, policy ${saved.policyName})`);
    return saved;
  }

  async updateHold(actor: LegalHoldActor, id: string, input: UpdateLegalHoldInput): Promise<LegalHold> {
    this.assertAuthorized(actor);
    const hold = await this.findOwnedActiveHold(actor, id);
    if (input.reason !== undefined) hold.reason = this.requireReason(input.reason);
    if (input.expiresAt !== undefined) hold.expiresAt = this.requireFutureOrNull(input.expiresAt);
    const saved = await this.holds.save(hold);
    this.logger.log(`Legal hold ${id} updated by ${actor.userId} (tenant ${actor.tenantId})`);
    return saved;
  }

  async releaseHold(actor: LegalHoldActor, id: string): Promise<LegalHold> {
    this.assertAuthorized(actor);
    const hold = await this.findOwnedHold(actor, id);
    if (hold.releasedAt) return hold;
    hold.releasedAt = new Date();
    hold.releasedBy = actor.userId;
    const saved = await this.holds.save(hold);
    this.logger.log(`Legal hold ${id} released by ${actor.userId} (tenant ${actor.tenantId})`);
    return saved;
  }

  private assertAuthorized(actor: LegalHoldActor): void {
    if (!actor.roles.some((role) => LEGAL_HOLD_ROLES.includes(role))) {
      throw new ForbiddenException(`Legal hold changes require one of: ${LEGAL_HOLD_ROLES.join(', ')}`);
    }
  }

  /** Tenant-scoped lookup: another tenant's hold is reported as not found. */
  private async findOwnedHold(actor: LegalHoldActor, id: string): Promise<LegalHold> {
    const hold = await this.holds.findOne({ where: { id, tenantId: actor.tenantId } });
    if (!hold) throw new NotFoundException('Legal hold not found');
    return hold;
  }

  private async findOwnedActiveHold(actor: LegalHoldActor, id: string): Promise<LegalHold> {
    const hold = await this.findOwnedHold(actor, id);
    if (hold.releasedAt) throw new BadRequestException('Legal hold has already been released');
    return hold;
  }

  private requireReason(reason: string): string {
    const trimmed = (reason ?? '').trim();
    if (!trimmed) throw new BadRequestException('A reason is required for a legal hold');
    return trimmed;
  }

  private requireFutureOrNull(expiresAt: Date | null | undefined): Date | null {
    if (!expiresAt) return null;
    if (expiresAt.getTime() <= Date.now()) throw new BadRequestException('expiresAt must be in the future');
    return expiresAt;
  }
}
