import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('liquidity_pools')
@Index(['dexId', 'assetCodeA', 'assetCodeB'])
export class LiquidityPoolEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'pool_id', length: 100, unique: true })
  poolId: string;

  @Column({ name: 'dex_id', length: 50 })
  dexId: string;

  @Column({ name: 'asset_code_a', length: 12 })
  assetCodeA: string;

  @Column({ name: 'asset_issuer_a', length: 60, nullable: true })
  assetIssuerA: string;

  @Column({ name: 'asset_code_b', length: 12 })
  assetCodeB: string;

  @Column({ name: 'asset_issuer_b', length: 60, nullable: true })
  assetIssuerB: string;

  @Column({
    name: 'total_value_locked',
    type: 'decimal',
    precision: 20,
    scale: 7,
  })
  totalValueLocked: number;

  @Column({ name: 'volume_24h', type: 'decimal', precision: 20, scale: 7 })
  volume24h: number;

  @Column({ name: 'fee', type: 'decimal', precision: 10, scale: 6 })
  fee: number;

  @Column({ name: 'reserve_a', type: 'decimal', precision: 20, scale: 7 })
  reserveA: number;

  @Column({ name: 'reserve_b', type: 'decimal', precision: 20, scale: 7 })
  reserveB: number;

  @Column({
    name: 'last_synced_at',
    type: 'timestamptz',
    nullable: true,
  })
  lastSyncedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
