import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('sla_metrics')
@Index(['service', 'timestamp'])
export class SlaMetric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  service: string;

  @Column('decimal', { precision: 5, scale: 2 })
  responseTime: number;

  @Column('boolean', { default: true })
  isAvailable: boolean;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  uptimePercentage: number;

  @Column('boolean', { default: false })
  breached: boolean;

  @Column({ nullable: true })
  breachReason: string;

  @CreateDateColumn()
  timestamp: Date;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any>;
}
