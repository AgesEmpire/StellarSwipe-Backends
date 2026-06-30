import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum ProposalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXECUTED = 'EXECUTED',
}

@Entity('contract_upgrade_proposals')
export class ContractUpgradeProposal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contract_id' })
  contractId: string;

  @Column({ name: 'wasm_hash' })
  wasmHash: string;

  @Column({ name: 'proposer_id' })
  proposerId: string;

  @Column({
    type: 'enum',
    enum: ProposalStatus,
    default: ProposalStatus.PENDING,
  })
  status: ProposalStatus;

  @Column({ name: 'approval_threshold', default: 2 })
  approvalThreshold: number;

  @Column({ name: 'approval_count', default: 0 })
  approvalCount: number;

  @Column({ type: 'jsonb', nullable: true })
  approvals: Array<{ approverId: string; timestamp: Date; signature?: string }>;

  @Column({ type: 'jsonb', nullable: true })
  rejections: Array<{ approverId: string; timestamp: Date; reason?: string }>;

  @Column({ name: 'executed_tx_hash', nullable: true })
  executedTxHash: string;

  @Column({ name: 'executed_at', nullable: true })
  executedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
