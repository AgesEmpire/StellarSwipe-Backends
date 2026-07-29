import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContractUpgradeProposal, ProposalStatus } from './entities/contract-upgrade-proposal.entity';
import { AuditAction } from '../audit-log/audit-log.entity';
import { AuditService } from '../audit-log/audit.service';

export interface CreateProposalDto {
  contractId: string;
  wasmHash: string;
  proposerId: string;
  approvalThreshold?: number;
}

export interface ApprovalDto {
  approverId: string;
  approve: boolean;
  reason?: string;
  signature?: string;
}

@Injectable()
export class ContractUpgradeGovernanceService {
  private readonly logger = new Logger(ContractUpgradeGovernanceService.name);

  constructor(
    @InjectRepository(ContractUpgradeProposal)
    private readonly proposalRepo: Repository<ContractUpgradeProposal>,
    private readonly auditService: AuditService,
  ) {}

  async createProposal(dto: CreateProposalDto): Promise<ContractUpgradeProposal> {
    const proposal = this.proposalRepo.create({
      contractId: dto.contractId,
      wasmHash: dto.wasmHash,
      proposerId: dto.proposerId,
      approvalThreshold: dto.approvalThreshold || 2,
      status: ProposalStatus.PENDING,
      approvalCount: 0,
      approvals: [],
      rejections: [],
    });

    const saved = await this.proposalRepo.save(proposal);

    await this.auditService.log({
      action: AuditAction.SYSTEM_ERROR,
      userId: dto.proposerId,
      resource: 'contract_upgrade_proposal',
      resourceId: saved.id,
      metadata: { contractId: dto.contractId, wasmHash: dto.wasmHash },
    });

    this.logger.log(`Proposal created: ${saved.id} for contract ${dto.contractId}`);
    return saved;
  }

  async approveProposal(proposalId: string, dto: ApprovalDto): Promise<ContractUpgradeProposal> {
    const proposal = await this.proposalRepo.findOne({ where: { id: proposalId } });
    if (!proposal) throw new NotFoundException('Proposal not found');
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new BadRequestException('Proposal is not in pending state');
    }

    const existingApproval = proposal.approvals?.find(a => a.approverId === dto.approverId);
    if (existingApproval) {
      throw new BadRequestException('Already approved or rejected by this approver');
    }

    if (dto.approve) {
      proposal.approvals = proposal.approvals || [];
      proposal.approvals.push({
        approverId: dto.approverId,
        timestamp: new Date(),
        signature: dto.signature,
      });
      proposal.approvalCount = proposal.approvals.length;

      await this.auditService.log({
        action: AuditAction.SYSTEM_ERROR,
        userId: dto.approverId,
        resource: 'contract_upgrade_proposal',
        resourceId: proposalId,
        metadata: { action: 'approve', wasmHash: proposal.wasmHash },
      });

      if (proposal.approvalCount >= proposal.approvalThreshold) {
        proposal.status = ProposalStatus.APPROVED;
        this.logger.log(`Proposal ${proposalId} approved and ready for execution`);
      }
    } else {
      proposal.rejections = proposal.rejections || [];
      proposal.rejections.push({
        approverId: dto.approverId,
        timestamp: new Date(),
        reason: dto.reason,
      });
      proposal.status = ProposalStatus.REJECTED;

      await this.auditService.log({
        action: AuditAction.SYSTEM_ERROR,
        userId: dto.approverId,
        resource: 'contract_upgrade_proposal',
        resourceId: proposalId,
        metadata: { action: 'reject', reason: dto.reason },
      });

      this.logger.log(`Proposal ${proposalId} rejected`);
    }

    return this.proposalRepo.save(proposal);
  }

  async getProposal(proposalId: string): Promise<ContractUpgradeProposal> {
    const proposal = await this.proposalRepo.findOne({ where: { id: proposalId } });
    if (!proposal) throw new NotFoundException('Proposal not found');
    return proposal;
  }

  async canExecuteUpgrade(proposalId: string): Promise<boolean> {
    const proposal = await this.getProposal(proposalId);
    return proposal.status === ProposalStatus.APPROVED;
  }

  async markExecuted(proposalId: string, txHash: string): Promise<ContractUpgradeProposal> {
    const proposal = await this.getProposal(proposalId);
    if (proposal.status !== ProposalStatus.APPROVED) {
      throw new BadRequestException('Proposal must be approved before execution');
    }

    proposal.status = ProposalStatus.EXECUTED;
    proposal.executedTxHash = txHash;
    proposal.executedAt = new Date();

    await this.auditService.log({
      action: AuditAction.SYSTEM_ERROR,
      resource: 'contract_upgrade_proposal',
      resourceId: proposalId,
      metadata: { txHash, executedAt: proposal.executedAt },
    });

    this.logger.log(`Proposal ${proposalId} executed with tx ${txHash}`);
    return this.proposalRepo.save(proposal);
  }
}
