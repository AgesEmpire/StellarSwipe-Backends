import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ModelType } from '../interfaces/ml-model.interface';

@Entity('ml_model_versions')
@Index(['modelType', 'isActive'])
export class ModelVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'model_type', type: 'enum', enum: ModelType })
  modelType!: ModelType;

  @Column({ length: 50 })
  version!: string;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive!: boolean;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  accuracy!: number;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  precision!: number;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  recall!: number;

  @Column({ name: 'f1_score', type: 'decimal', precision: 5, scale: 4, default: 0 })
  f1Score!: number;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  auc!: number;

  @Column({ name: 'samples_used', type: 'int', default: 0 })
  samplesUsed!: number;

  @Column({ name: 'training_duration_ms', type: 'int', default: 0 })
  trainingDurationMs!: number;

  @Column({ name: 'model_data', type: 'jsonb' })
  modelData!: Record<string, any>;

  @Column({ name: 'feature_importance', type: 'jsonb', nullable: true })
  featureImportance!: Record<string, number> | null;

  @Column({ name: 'training_config', type: 'jsonb', nullable: true })
  trainingConfig!: Record<string, any> | null;

  @Column({ name: 'trained_at', type: 'timestamp with time zone' })
  trainedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;
}
