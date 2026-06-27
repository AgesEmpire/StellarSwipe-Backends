import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Index('idx_archived_positions_user_closed', ['userId', 'closedAt'])
@Index('idx_archived_positions_archived', ['archivedAt'])
@Entity('archived_positions')
export class ArchivedPosition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'original_position_id', type: 'uuid' })
  originalPositionId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'trade_id', type: 'uuid', nullable: true })
  tradeId?: string;

  @Column({ name: 'base_asset', length: 100, nullable: true })
  baseAsset?: string;

  @Column({ name: 'counter_asset', length: 100, nullable: true })
  counterAsset?: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  side?: string;

  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true })
  amount?: string;

  @Column({ name: 'entry_price', type: 'decimal', precision: 18, scale: 8, nullable: true })
  entryPrice?: string;

  @Column({ name: 'exit_price', type: 'decimal', precision: 18, scale: 8, nullable: true })
  exitPrice?: string;

  @Column({ name: 'realized_pnl', type: 'decimal', precision: 18, scale: 8, nullable: true })
  realizedPnL?: string;

  @Column({ name: 'closed_at', type: 'timestamptz' })
  closedAt!: Date;

  @Column({ name: 'archived_at', type: 'timestamptz' })
  archivedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}