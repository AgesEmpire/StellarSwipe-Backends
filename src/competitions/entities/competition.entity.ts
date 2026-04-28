import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToOne,
} from 'typeorm';
import type { CompetitionRules } from '../interfaces/competition-rules.interface';
import { PrizePool } from './prize-pool.entity';

export enum CompetitionStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  LIVE = 'LIVE',
  ENDED = 'ENDED',
  PRIZES_DISTRIBUTED = 'PRIZES_DISTRIBUTED',
  CANCELLED = 'CANCELLED',
}

@Entity('competitions')
@Index(['status', 'startsAt', 'endsAt'])
export class Competition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ name: 'starts_at', type: 'timestamp with time zone' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamp with time zone' })
  endsAt!: Date;

  @Column({
    type: 'varchar',
    length: 32,
    default: CompetitionStatus.DRAFT,
  })
  status!: CompetitionStatus;

  @Column({ name: 'rules_json', type: 'jsonb', default: () => "'{}'" })
  rules!: CompetitionRules;

  @Column({ name: 'scoring_metric', type: 'varchar', length: 32, default: 'PNL' })
  scoringMetric!: string;

  @OneToOne(() => PrizePool, (pool) => pool.competition, { cascade: true })
  prizePool!: PrizePool;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
