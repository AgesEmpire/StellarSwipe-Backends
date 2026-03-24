import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum EtlJobStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum EtlJobType {
  USER_EVENTS = 'user_events',
  TRADES = 'trades',
  SIGNALS = 'signals',
}

@Entity('etl_jobs')
export class EtlJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  jobType: EtlJobType;

  @Column({ type: 'varchar', default: EtlJobStatus.RUNNING })
  status: EtlJobStatus;

  @Column({ type: 'timestamptz' })
  startDate: Date;

  @Column({ type: 'timestamptz' })
  endDate: Date;

  @Column({ default: 0 })
  recordsProcessed: number;

  @Column({ nullable: true, type: 'varchar' })
  partitionPath: string;

  @Column({ nullable: true, type: 'text' })
  errorMessage: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
