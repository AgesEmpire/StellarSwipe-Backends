import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export enum PositionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  PENDING = 'PENDING',
}

@Entity('positions')
@Index(['status', 'symbol']) // Speed up open-position queries
export class Position {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  symbol: string;

  @Column('decimal', { precision: 18, scale: 8 })
  entryPrice: number;

  @Column('decimal', { precision: 18, scale: 8 })
  quantity: number;

  @Column({ type: 'enum', enum: PositionStatus, default: PositionStatus.OPEN })
  status: PositionStatus;

  // ── Stop-loss ──────────────────────────────────────────────
  @Column('decimal', { precision: 18, scale: 8, nullable: true })
  stopLossPrice: number | null;

  @Column({ default: false })
  isTrailingStop: boolean;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  trailingPercent: number | null;

  /** Tracks the highest price seen — used by trailing stop logic */
  @Column('decimal', { precision: 18, scale: 8, nullable: true })
  highestPrice: number | null;

  // ── Take-profit ────────────────────────────────────────────
  @Column('decimal', { precision: 18, scale: 8, nullable: true })
  takeProfitPrice: number | null;

  @Column('jsonb', { nullable: true })
  takeProfitLevels: Array<{ price: number; closePercent: number; executed?: boolean }> | null;

  // ── Exit metadata ──────────────────────────────────────────
  @Column('decimal', { precision: 18, scale: 8, nullable: true })
  exitPrice: number | null;

  @Column({ nullable: true })
  exitReason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
