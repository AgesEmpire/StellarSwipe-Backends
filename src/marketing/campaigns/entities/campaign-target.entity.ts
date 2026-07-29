import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';

export enum TargetType {
  COUNTRY = 'country',
  REGION = 'region',
  USER_SEGMENT = 'userSegment',
  LANGUAGE = 'language',
  USER_TIER = 'userTier',
}

@Entity('campaign_targets')
@Index(['campaignId'])
@Index(['targetType', 'targetValue'])
export class CampaignTarget {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  campaignId!: string;

  @ManyToOne(() => Campaign, (c) => c.targets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign!: Campaign;

  @Column({ type: 'enum', enum: TargetType })
  targetType!: TargetType;

  @Column({ type: 'varchar', length: 100 })
  targetValue!: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 1 })
  weight!: number;

  @Column({ type: 'jsonb', default: '{}' })
  criteria!: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
