import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ContractJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DEAD_LETTERED = 'dead_lettered',
}

@Entity('contract_jobs')
export class ContractJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  contractId!: string;

  @Column()
  method!: string;

  @Column({ type: 'jsonb', default: [] })
  params!: unknown[];

  @Column({ type: 'jsonb', nullable: true })
  options!: Record<string, unknown> | null;

  @Column({ type: 'enum', enum: ContractJobStatus, default: ContractJobStatus.PENDING })
  status!: ContractJobStatus;

  @Column({ nullable: true, type: 'varchar' })
  txHash!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  result!: unknown | null;

  @Column({ nullable: true, type: 'text' })
  error!: string | null;

  @Column({ default: 0 })
  attempts!: number;

  @Column({ nullable: true, type: 'varchar' })
  bullJobId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
