import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { MetricType } from './sla-metric.entity';

export enum ViolationSeverity {
  WARNING = 'warning',   // approaching threshold
  BREACH = 'breach',     // threshold exceeded
  CRITICAL = 'critical', // severely exceeded
}

@Entity('sla_violations')
@Index(['agreementId', 'createdAt'])
export class SlaViolation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agreement_id' })
  @Index()
  agreementId!: string;

  @Column({ type: 'enum', enum: MetricType })
  metricType!: MetricType;

  @Column({ type: 'enum', enum: ViolationSeverity })
  @Index()
  severity!: ViolationSeverity;

  @Column({ name: 'threshold_value', type: 'decimal', precision: 12, scale: 4 })
  thresholdValue!: string;

  @Column({ name: 'actual_value', type: 'decimal', precision: 12, scale: 4 })
  actualValue!: string;

  @Column({ type: 'text', nullable: true })
  message?: string;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt?: Date;

  @Column({ name: 'alert_sent', default: false })
  alertSent!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
