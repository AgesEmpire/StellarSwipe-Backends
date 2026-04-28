import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum InsightType {
  STRENGTH = 'strength',
  WEAKNESS = 'weakness',
  OPPORTUNITY = 'opportunity',
}

@Entity('pattern_insights')
@Index(['userId'])
export class PatternInsight {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'insight_type', type: 'enum', enum: InsightType })
  insightType!: InsightType;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ name: 'pattern_type', type: 'varchar', length: 50 })
  patternType!: string;

  @Column({ type: 'jsonb', nullable: true })
  data?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
