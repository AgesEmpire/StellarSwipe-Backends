export enum ApprovalWorkflowStatus {
  PENDING = 'pending',
  PARTIALLY_APPROVED = 'partially_approved',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export class ApprovalResponseDto {
  approvalId!: string;
  transactionId!: string;
  status!: ApprovalWorkflowStatus;
  approvalCount!: number;
  requiredApprovals!: number;
  message!: string;
}
