import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { SignalOutcome } from '../../../signals/entities/signal.entity';

@Entity('ml_training_data')
@Index(['signalId'], { unique: true })
@Index(['providerId', 'collectedAt'])
@Index(['isValidated', 'collectedAt'])
export class TrainingData {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'signal_id', type: 'uuid' })
  signalId!: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  providerId!: string;

  @Column({ name: 'asset_pair', length: 50 })
  assetPair!: string;

  @Column({ name: 'feature_vector', type: 'jsonb' })
  featureVector!: number[];

  @Column({ name: 'feature_snapshot', type: 'jsonb' })
  featureSnapshot!: Record<string, any>;

  @Column({ name: 'success_label', type: 'smallint' })
  successLabel!: 0 | 1;

  @Column({ name: 'pnl_label', type: 'decimal', precision: 10, scale: 6 })
  pnlLabel!: number;

  @Column({
    type: 'enum',
    enum: SignalOutcome,
  })
  outcome!: SignalOutcome;

  @Column({ name: 'is_validated', type: 'boolean', default: true })
  isValidated!: boolean;

  @Column({ name: 'collected_at', type: 'timestamp with time zone' })
  collectedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;
}
