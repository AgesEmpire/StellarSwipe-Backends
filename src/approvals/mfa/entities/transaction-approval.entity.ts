import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ApprovalWorkflowStatus } from '../dto/approval-response.dto';

@Entity('transaction_approvals')
export class TransactionApproval {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  transactionId!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'enum', enum: ApprovalWorkflowStatus, default: ApprovalWorkflowStatus.PENDING })
  status!: ApprovalWorkflowStatus;

  @Column({ type: 'simple-array', nullable: true })
  approverIds?: string[];

  @Column({ type: 'int', default: 2 })
  requiredApprovals!: number;

  @Column({ type: 'int', default: 0 })
  approvalCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
