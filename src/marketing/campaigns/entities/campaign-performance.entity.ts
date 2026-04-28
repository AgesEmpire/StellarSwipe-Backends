import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';

@Entity('campaign_performance')
@Index(['campaignId', 'date'])
@Index(['date'])
export class CampaignPerformance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  campaignId!: string;

  @ManyToOne(() => Campaign, (c) => c.performance, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign!: Campaign;

  @Column({ type: 'date' })
  date!: Date;

  @Column({ type: 'integer', default: 0 })
  impressions!: number;

  @Column({ type: 'integer', default: 0 })
  clicks!: number;

  @Column({ type: 'integer', default: 0 })
  conversions!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  revenue!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  spend!: number;

  @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
  ctr!: number;

  @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
  conversionRate!: number;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;
}
