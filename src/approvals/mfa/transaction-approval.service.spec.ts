import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { TransactionApprovalService } from './transaction-approval.service';
import { TransactionApproval } from './entities/transaction-approval.entity';
import { ApprovalWorkflowStatus } from './dto/approval-response.dto';

describe('TransactionApprovalService', () => {
  let service: TransactionApprovalService;
  let mockRepo: any;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionApprovalService,
        { provide: getRepositoryToken(TransactionApproval), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<TransactionApprovalService>(TransactionApprovalService);
  });

  describe('createApprovalRequest', () => {
    it('should create a pending approval request', async () => {
      const dto = { transactionId: 'tx-1', description: 'High-risk transaction' };
      const approval = { id: 'a1', ...dto, status: ApprovalWorkflowStatus.PENDING, requiredApprovals: 2, approvalCount: 0 };
      mockRepo.create.mockReturnValue(approval);
      mockRepo.save.mockResolvedValue(approval);

      const result = await service.createApprovalRequest(dto);
      expect(result.status).toBe(ApprovalWorkflowStatus.PENDING);
      expect(result.requiredApprovals).toBe(2);
    });
  });

  describe('issueMfaChallenge', () => {
    it('should issue MFA challenge for valid approval', async () => {
      const approval = { id: 'a1', status: ApprovalWorkflowStatus.PENDING, requiredApprovals: 2, approvalCount: 0 };
      mockRepo.findOne.mockResolvedValue(approval);

      const result = await service.issueMfaChallenge('a1', 'approver-1');
      expect(result.challengeId).toBeDefined();
      expect(result.message).toContain('MFA challenge');
    });

    it('should throw NotFoundException for unknown approval', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.issueMfaChallenge('bad-id', 'approver-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('submitApproval', () => {
    it('should reject with ForbiddenException for invalid challenge', async () => {
      const approval = { id: 'a1', status: ApprovalWorkflowStatus.PENDING, requiredApprovals: 2, approvalCount: 0 };
      mockRepo.findOne.mockResolvedValue(approval);

      await expect(
        service.submitApproval('a1', 'invalid-challenge-id', { approverId: 'u1', mfaCode: '123456' })
      ).rejects.toThrow(ForbiddenException);
    });

    it('should approve transaction when enough approvals received', async () => {
      const approval = { id: 'a1', transactionId: 'tx1', status: ApprovalWorkflowStatus.PENDING, requiredApprovals: 2, approvalCount: 1, approverIds: ['u1'] };
      mockRepo.findOne.mockResolvedValue(approval);
      mockRepo.save.mockResolvedValue({ ...approval, approvalCount: 2, status: ApprovalWorkflowStatus.APPROVED, approverIds: ['u1', 'u2'] });

      const challengeResult = await service.issueMfaChallenge('a1', 'u2');
      const challengeId = challengeResult.challengeId;
      const code = (service as any).pendingChallenges.get(challengeId)?.code;

      const result = await service.submitApproval('a1', challengeId, { approverId: 'u2', mfaCode: code });
      expect(result.status).toBe(ApprovalWorkflowStatus.APPROVED);
    });
  });
});
