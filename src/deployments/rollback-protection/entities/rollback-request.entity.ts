import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum RollbackStatus {
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  BLOCKED = 'blocked',
}

@Entity('rollback_requests')
export class RollbackRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 100 })
  serviceName!: string;

  @Column({ length: 50 })
  targetVersion!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'uuid' })
  requestedBy!: string;

  @Column({ type: 'enum', enum: RollbackStatus, default: RollbackStatus.PENDING_APPROVAL })
  status!: RollbackStatus;

  @Column({ default: false })
  isProtected!: boolean;

  @Column({ type: 'uuid', nullable: true })
  approvedBy?: string;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
