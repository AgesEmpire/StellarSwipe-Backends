import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type DriftSeverity = 'stable' | 'minor' | 'significant';

@Entity('drift_findings')
@Index(['feedKey', 'detectedAt'])
export class DriftFinding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Identifier for the monitored metric / feed */
  @Column({ name: 'feed_key', type: 'varchar', length: 128 })
  @Index()
  feedKey!: string;

  @Column({ type: 'varchar', length: 16 })
  severity!: DriftSeverity;

  /** Population Stability Index */
  @Column({ type: 'numeric', precision: 12, scale: 6 })
  psi!: number;

  /** Jensen-Shannon divergence (0–1) */
  @Column({ name: 'js_divergence', type: 'numeric', precision: 12, scale: 6 })
  jsDivergence!: number;

  @Column({ name: 'current_mean', type: 'numeric', precision: 18, scale: 6 })
  currentMean!: number;

  @Column({ name: 'baseline_mean', type: 'numeric', precision: 18, scale: 6 })
  baselineMean!: number;

  @Column({ name: 'current_std_dev', type: 'numeric', precision: 18, scale: 6 })
  currentStdDev!: number;

  @Column({ name: 'baseline_std_dev', type: 'numeric', precision: 18, scale: 6 })
  baselineStdDev!: number;

  /** Relative mean shift as a fraction of the baseline mean */
  @Column({ name: 'mean_shift_ratio', type: 'numeric', precision: 12, scale: 6 })
  meanShiftRatio!: number;

  @Column({ name: 'detected_at', type: 'timestamptz' })
  detectedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
