import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum PatternType {
  WIN_LOSS = 'win_loss',
  TIMING = 'timing',
  SIZING = 'sizing',
  HOLDING_PERIOD = 'holding_period',
}

@Entity('trading_patterns')
@Index(['userId', 'patternType'])
export class TradingPattern {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId!: string;

  @Column({ name: 'pattern_type', type: 'enum', enum: PatternType })
  patternType!: PatternType;

  @Column({ type: 'jsonb' })
  metrics!: object;

  @Column({ name: 'analyzed_at', type: 'timestamptz' })
  analyzedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
