import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { SignalAction } from '../dto/create-signal.dto';

export enum SignalStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Entity('signals')
@Index(['providerId', 'createdAt'])
@Index(['assetPair', 'status'])
@Index(['status', 'expiresAt'])
export class Signal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  providerId: string;

  @Column()
  providerAddress: string;

  @Column()
  assetPair: string;

  @Column({
    type: 'enum',
    enum: SignalAction,
  })
  action: SignalAction;

  @Column('decimal', { precision: 18, scale: 8 })
  entryPrice: number;

  @Column('decimal', { precision: 18, scale: 8 })
  targetPrice: number;

  @Column('decimal', { precision: 18, scale: 8 })
  stopLoss: number;

  @Column('text')
  rationale: string;

  @Column('decimal', { precision: 5, scale: 2 })
  qualityScore: number;

  @Column('decimal', { precision: 5, scale: 2 })
  confidenceScore: number;

  @Column()
  stakeAmount: string;

  @Column({
    type: 'enum',
    enum: SignalStatus,
    default: SignalStatus.ACTIVE,
  })
  @Index()
  status: SignalStatus;

  @Column()
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Optional tracking fields
  @Column({ nullable: true })
  targetHitAt?: Date;

  @Column({ nullable: true })
  stopLossHitAt?: Date;

  @Column('decimal', { precision: 18, scale: 8, nullable: true })
  actualExitPrice?: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  profitLossPercentage?: number;
}