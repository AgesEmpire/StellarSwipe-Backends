import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum TradeStatus {
  OPEN = 'OPEN',
  PENDING = 'PENDING',
  CLOSED = 'CLOSED',
}

export enum TradeSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

@Entity('trades')
export class Trade {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @ManyToOne(() => User, (user) => user.trades)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  assetSymbol!: string;

  @Column('decimal', { precision: 20, scale: 8 })
  amount!: number;

  @Column('decimal', { precision: 20, scale: 8 })
  entryPrice!: number;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  closePrice!: number;

  @Column({
    type: 'enum',
    enum: TradeStatus,
    default: TradeStatus.OPEN,
  })
  status!: TradeStatus;

  @Column({
    type: 'enum',
    enum: TradeSide,
  })
  side!: TradeSide;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  realizedPnl!: number;

  @CreateDateColumn()
  openedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  closedAt!: Date;
}
