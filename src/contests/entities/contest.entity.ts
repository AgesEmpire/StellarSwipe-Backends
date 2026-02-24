import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ContestMetric {
  HIGHEST_ROI = 'HIGHEST_ROI',
  BEST_SUCCESS_RATE = 'BEST_SUCCESS_RATE',
  MOST_VOLUME = 'MOST_VOLUME',
  MOST_FOLLOWERS = 'MOST_FOLLOWERS',
}

export enum ContestStatus {
  ACTIVE = 'ACTIVE',
  FINALIZED = 'FINALIZED',
  CANCELLED = 'CANCELLED',
}

@Entity('contests')
@Index(['status', 'startTime', 'endTime'])
export class Contest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 255 })
  name!: string;

  @Column({ name: 'start_time', type: 'timestamp with time zone' })
  startTime!: Date;

  @Column({ name: 'end_time', type: 'timestamp with time zone' })
  endTime!: Date;

  @Column({
    type: 'enum',
    enum: ContestMetric,
    default: ContestMetric.HIGHEST_ROI,
  })
  metric!: ContestMetric;

  @Column({ name: 'min_signals', type: 'int', default: 3 })
  minSignals!: number;

  @Column({
    name: 'prize_pool',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: '0',
  })
  prizePool!: string;

  @Column({
    type: 'enum',
    enum: ContestStatus,
    default: ContestStatus.ACTIVE,
  })
  status!: ContestStatus;

  @Column({ type: 'jsonb', nullable: true })
  winners!: string[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
