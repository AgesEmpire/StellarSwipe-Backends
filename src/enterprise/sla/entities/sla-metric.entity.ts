import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum MetricType {
  UPTIME = 'uptime',
  RESPONSE_TIME = 'response_time',
  ERROR_RATE = 'error_rate',
  THROUGHPUT = 'throughput',
}

@Entity('sla_metrics')
@Index(['agreementId', 'type', 'recordedAt'])
export class SlaMetric {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agreement_id' })
  @Index()
  agreementId!: string;

  @Column({ type: 'enum', enum: MetricType })
  type!: MetricType;

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  value!: string;

  @Column({ name: 'window_minutes', type: 'int' })
  windowMinutes!: number;

  @Column({ name: 'sample_count', type: 'int', default: 0 })
  sampleCount!: number;

  @Column({ name: 'recorded_at', type: 'timestamp' })
  @Index()
  recordedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
