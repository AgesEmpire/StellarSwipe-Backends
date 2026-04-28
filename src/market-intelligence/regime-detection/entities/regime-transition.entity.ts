import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { MarketRegimeType } from './market-regime.entity';

@Entity('regime_transition')
export class RegimeTransition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'asset_pair', nullable: true })
  @Index()
  assetPair: string | null;

  @Column({
    name: 'from_regime',
    type: 'enum',
    enum: MarketRegimeType,
  })
  fromRegime: MarketRegimeType;

  @Column({
    name: 'to_regime',
    type: 'enum',
    enum: MarketRegimeType,
  })
  toRegime: MarketRegimeType;

  @Column({ type: 'decimal', precision: 5, scale: 4 })
  confidence: number;

  @Column({ nullable: true })
  reason: string | null;

  @Column({ type: 'jsonb', nullable: true })
  triggerMetrics: Record<string, any> | null;

  @CreateDateColumn({ name: 'occurred_at' })
  occurredAt: Date;
}
