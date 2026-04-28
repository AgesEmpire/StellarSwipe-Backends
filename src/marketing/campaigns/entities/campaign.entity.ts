import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { CampaignTarget } from './campaign-target.entity';
import { CampaignPerformance } from './campaign-performance.entity';

export enum CampaignStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum CampaignType {
  PROMOTIONAL = 'promotional',
  EDUCATIONAL = 'educational',
  ENGAGEMENT = 'engagement',
  RETENTION = 'retention',
  ACQUISITION = 'acquisition',
}

@Entity('campaigns')
@Index(['region', 'status'])
@Index(['status'])
@Index(['startDate', 'endDate'])
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 10 })
  @Index()
  region!: string;

  @Column({ type: 'enum', enum: CampaignStatus, default: CampaignStatus.DRAFT })
  status!: CampaignStatus;

  @Column({ type: 'enum', enum: CampaignType })
  type!: CampaignType;

  @Column({ type: 'timestamp with time zone' })
  startDate!: Date;

  @Column({ type: 'timestamp with time zone' })
  endDate!: Date;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  budget!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  spentBudget!: number;

  @Column({ type: 'jsonb', default: '{}' })
  localizedContent!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: '{}' })
  localizedPricing!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdBy!: string | null;

  @OneToMany(() => CampaignTarget, (t) => t.campaign, { cascade: true })
  targets!: CampaignTarget[];

  @OneToMany(() => CampaignPerformance, (p) => p.campaign)
  performance!: CampaignPerformance[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
