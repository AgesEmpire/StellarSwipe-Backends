import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { SlaTierName } from '../interfaces/sla-tier.interface';

export enum SlaAgreementStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  EXPIRED = 'expired',
  TERMINATED = 'terminated',
}

@Entity('sla_agreements')
@Index(['userId', 'status'])
export class SlaAgreement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  @Index()
  userId!: string;

  @Column({ name: 'client_name', length: 255 })
  clientName!: string;

  @Column({ type: 'enum', enum: SlaTierName })
  @Index()
  tier!: SlaTierName;

  @Column({ name: 'uptime_percent', type: 'decimal', precision: 5, scale: 2 })
  uptimePercent!: string;

  @Column({ name: 'max_response_time_ms', type: 'int' })
  maxResponseTimeMs!: number;

  @Column({ name: 'max_error_rate_percent', type: 'decimal', precision: 5, scale: 2 })
  maxErrorRatePercent!: string;

  @Column({ name: 'min_throughput_rpm', type: 'int' })
  minThroughputRpm!: number;

  @Column({ name: 'support_response_hours', type: 'int' })
  supportResponseHours!: number;

  @Column({ name: 'priority_routing', default: false })
  priorityRouting!: boolean;

  @Column({ type: 'enum', enum: SlaAgreementStatus, default: SlaAgreementStatus.ACTIVE })
  @Index()
  status!: SlaAgreementStatus;

  @Column({ name: 'starts_at', type: 'timestamp' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamp', nullable: true })
  endsAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
