import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum MarketRegimeType {
  BULL = 'bull',
  BEAR = 'bear',
  SIDEWAYS = 'sideways',
  VOLATILE = 'volatile',
}

@Entity('market_regime')
export class MarketRegime {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'asset_pair', nullable: true })
  @Index()
  assetPair: string | null; // null for global/market-wide regime

  @Column({
    type: 'enum',
    enum: MarketRegimeType,
    default: MarketRegimeType.SIDEWAYS,
  })
  type: MarketRegimeType;

  @Column({ type: 'decimal', precision: 5, scale: 4 })
  confidence: number;

  @Column({ name: 'start_time', type: 'timestamptz' })
  startTime: Date;

  @Column({ name: 'end_time', type: 'timestamptz', nullable: true })
  endTime: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metrics: {
    volatility: number;
    trend: number;
    rsi?: number;
    adr?: number;
    [key: string]: any;
  } | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
