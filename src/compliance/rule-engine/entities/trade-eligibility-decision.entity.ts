import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum EligibilityDecisionOutcome {
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * Persisted audit record for every trade-eligibility decision made by the
 * compliance rule engine.  Immutable once written.
 */
@Entity('trade_eligibility_decisions')
@Index('idx_ted_user_id', ['userId'])
@Index('idx_ted_created_at', ['createdAt'])
export class TradeEligibilityDecision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'asset', type: 'varchar', length: 50 })
  asset!: string;

  @Column({
    name: 'counter_asset',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  counterAsset?: string;

  @Column({ name: 'amount', type: 'decimal', precision: 18, scale: 8 })
  amount!: string;

  @Column({
    name: 'outcome',
    type: 'enum',
    enum: EligibilityDecisionOutcome,
  })
  outcome!: EligibilityDecisionOutcome;

  /**
   * Comma-separated list of rule IDs that failed (empty when approved).
   */
  @Column({ name: 'failed_rules', type: 'text', nullable: true })
  failedRules?: string;

  /**
   * Human-readable rejection reasons joined by "; " (empty when approved).
   */
  @Column({ name: 'rejection_reasons', type: 'text', nullable: true })
  rejectionReasons?: string;

  /**
   * Full JSON snapshot of every rule result for deep audit inspection.
   */
  @Column({ name: 'rule_results', type: 'jsonb' })
  ruleResults!: Record<string, unknown>[];

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress?: string;

  @Column({ name: 'country_code', type: 'varchar', length: 2, nullable: true })
  countryCode?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
