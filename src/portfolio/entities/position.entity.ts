import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  Index,
} from 'typeorm';
import { TradeSide } from '../../trades/entities/trade.entity';

@Entity('positions')
export class Position {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'trade_id', type: 'uuid' })
  tradeId!: string;

  @Column({ name: 'base_asset', length: 100 })
  baseAsset!: string;

  @Column({ name: 'counter_asset', length: 100 })
  counterAsset!: string;

  @Column({
    type: 'enum',
    enum: TradeSide,
  })
  side!: TradeSide;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  amount!: string;

  @Column({ name: 'entry_price', type: 'decimal', precision: 18, scale: 8 })
  entryPrice!: string;

  @Column({ name: 'current_price', type: 'decimal', precision: 18, scale: 8 })
  currentPrice!: string;

  @Column({ name: 'unrealized_pnl', type: 'decimal', precision: 18, scale: 8, default: '0' })
  unrealizedPnL!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @VersionColumn({ name: 'version', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}