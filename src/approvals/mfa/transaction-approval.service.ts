import { Injectable, Logger, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionApproval } from './entities/transaction-approval.entity';
import { CreateApprovalRequestDto, SubmitApprovalDto } from './dto/approval-request.dto';
import { ApprovalResponseDto, ApprovalWorkflowStatus } from './dto/approval-response.dto';
import { generateMfaChallenge, isChallengeExpired } from './utils/mfa-challenge';

@Injectable()
export class TransactionApprovalService {
  private readonly logger = new Logger(TransactionApprovalService.name);
  private readonly pendingChallenges = new Map<string, { code: string; expiresAt: Date; approverId: string }>();

  constructor(
    @InjectRepository(TransactionApproval)
    private readonly approvalRepo: Repository<TransactionApproval>,
  ) {}

  async createApprovalRequest(dto: CreateApprovalRequestDto): Promise<ApprovalResponseDto> {
    const approval = this.approvalRepo.create({
      transactionId: dto.transactionId,
      description: dto.description,
      status: ApprovalWorkflowStatus.PENDING,
      requiredApprovals: 2,
      approvalCount: 0,
    });
    const saved = await this.approvalRepo.save(approval);
    return this.toResponseDto(saved);
  }

  async issueMfaChallenge(approvalId: string, approverId: string): Promise<{ challengeId: string; message: string }> {
    const approval = await this.approvalRepo.findOne({ where: { id: approvalId } });
    if (!approval) throw new NotFoundException('Approval request not found');
    if (approval.status === ApprovalWorkflowStatus.APPROVED) {
      throw new BadRequestException('Transaction is already approved');
    }

    const challenge = generateMfaChallenge();
    this.pendingChallenges.set(challenge.challengeId, {
      code: challenge.code,
      expiresAt: challenge.expiresAt,
      approverId,
    });

    this.logger.log(`MFA challenge issued for approver ${approverId} on approval ${approvalId}`);
    return { challengeId: challenge.challengeId, message: 'MFA challenge issued. Check your authenticator.' };
  }

  async submitApproval(approvalId: string, challengeId: string, dto: SubmitApprovalDto): Promise<ApprovalResponseDto> {
    const approval = await this.approvalRepo.findOne({ where: { id: approvalId } });
    if (!approval) throw new NotFoundException('Approval request not found');

    const challenge = this.pendingChallenges.get(challengeId);
    if (!challenge) throw new ForbiddenException('Invalid or expired MFA challenge');
    if (isChallengeExpired(challenge.expiresAt)) {
      this.pendingChallenges.delete(challengeId);
      throw new ForbiddenException('MFA challenge has expired');
    }
    if (challenge.code !== dto.mfaCode) {
      throw new ForbiddenException('Invalid MFA code');
    }

    this.pendingChallenges.delete(challengeId);

    const approverIds = approval.approverIds ?? [];
    if (approverIds.includes(dto.approverId)) {
      throw new BadRequestException('Approver has already submitted approval');
    }

    approval.approverIds = [...approverIds, dto.approverId];
    approval.approvalCount += 1;

    if (approval.approvalCount >= approval.requiredApprovals) {
      approval.status = ApprovalWorkflowStatus.APPROVED;
    } else {
      approval.status = ApprovalWorkflowStatus.PARTIALLY_APPROVED;
    }

    const saved = await this.approvalRepo.save(approval);
    this.logger.log(`Approval ${approvalId}: ${saved.approvalCount}/${saved.requiredApprovals} approvals`);
    return this.toResponseDto(saved);
  }

  private toResponseDto(a: TransactionApproval): ApprovalResponseDto {
    return {
      approvalId: a.id,
      transactionId: a.transactionId,
      status: a.status,
      approvalCount: a.approvalCount,
      requiredApprovals: a.requiredApprovals,
      message: a.status === ApprovalWorkflowStatus.APPROVED ? 'Transaction approved' : 'Awaiting approvals',
    };
  }
}
