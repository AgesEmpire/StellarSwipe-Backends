import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { SignalOutcome } from '../../../signals/entities/signal.entity';
import { PredictionConfidenceLevel } from '../interfaces/prediction-metadata.interface';

@Entity('ml_predictions')
@Index(['signalId'])
@Index(['providerId', 'createdAt'])
@Index(['modelVersionId'])
@Index(['isVerified', 'createdAt'])
export class Prediction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'signal_id', type: 'uuid' })
  signalId!: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  providerId!: string;

  @Column({ name: 'model_version_id', type: 'uuid', nullable: true })
  modelVersionId!: string | null;

  @Column({ name: 'success_probability', type: 'decimal', precision: 5, scale: 4 })
  successProbability!: number;

  @Column({ name: 'expected_pnl_low', type: 'decimal', precision: 10, scale: 6 })
  expectedPnlLow!: number;

  @Column({ name: 'expected_pnl_mid', type: 'decimal', precision: 10, scale: 6 })
  expectedPnlMid!: number;

  @Column({ name: 'expected_pnl_high', type: 'decimal', precision: 10, scale: 6 })
  expectedPnlHigh!: number;

  @Column({ name: 'confidence_score', type: 'decimal', precision: 5, scale: 4 })
  confidenceScore!: number;

  @Column({
    name: 'confidence_level',
    type: 'enum',
    enum: PredictionConfidenceLevel,
  })
  confidenceLevel!: PredictionConfidenceLevel;

  @Column({ name: 'feature_vector', type: 'jsonb' })
  featureVector!: number[];

  @Column({ name: 'model_contributions', type: 'jsonb' })
  modelContributions!: Record<string, any>[];

  @Column({ name: 'top_features', type: 'jsonb', nullable: true })
  topFeatures!: Array<{ name: string; importance: number }> | null;

  @Column({ name: 'warnings', type: 'jsonb', nullable: true })
  warnings!: string[] | null;

  @Column({ name: 'market_condition_summary', type: 'text', nullable: true })
  marketConditionSummary!: string | null;

  // Outcome fields — filled after signal closes
  @Column({ name: 'actual_outcome', type: 'enum', enum: SignalOutcome, nullable: true })
  actualOutcome!: SignalOutcome | null;

  @Column({ name: 'actual_pnl', type: 'decimal', precision: 10, scale: 6, nullable: true })
  actualPnl!: number | null;

  @Column({ name: 'was_correct', type: 'boolean', nullable: true })
  wasCorrect!: boolean | null;

  @Column({ name: 'is_verified', type: 'boolean', default: false })
  isVerified!: boolean;

  @Column({ name: 'verified_at', type: 'timestamp with time zone', nullable: true })
  verifiedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;
}
