import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Fully resolved copy settings; every field has a concrete value. */
export interface ResolvedCopySettings {
  /** Fraction (0-1] of the provider's position size the follower copies. */
  allocationRatio: number;
  /** Absolute cap on the notional value of one copied trade. */
  maxTradeAmount: number;
  /** Slippage tolerance in percent applied to copied orders. */
  slippageTolerancePct: number;
  /** Stop-loss distance in percent, or null to inherit from the signal. */
  stopLossPct: number | null;
  /** Take-profit distance in percent, or null to inherit from the signal. */
  takeProfitPct: number | null;
  /** Whether SELL signals are copied too. */
  copySells: boolean;
}

export type CopySettingsInput = Partial<ResolvedCopySettings>;

/**
 * Append-only version of a follower's copy policy for one provider (#1520).
 * Rows are never updated: a policy change always inserts a new version.
 */
@Entity('copy_policy_versions')
@Index(['followerId', 'providerId', 'version'], { unique: true })
export class CopyPolicyVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'follower_id', type: 'uuid' })
  followerId!: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  providerId!: string;

  /** Monotonic, 1-based version number per (follower, provider). */
  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'jsonb' })
  settings!: ResolvedCopySettings;

  /** Deterministic hash of `settings`, used to skip no-op updates. */
  @Column({ name: 'settings_hash', type: 'varchar', length: 64 })
  settingsHash!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;
}

/**
 * Immutable snapshot linking a follower trade execution to the exact policy
 * version (and resolved settings) that governed it (#1520).
 */
@Entity('copy_trade_executions')
@Index(['tradeId'], { unique: true })
@Index(['followerId', 'providerId'])
export class CopyTradeExecution {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'trade_id', type: 'uuid' })
  tradeId!: string;

  @Column({ name: 'follower_id', type: 'uuid' })
  followerId!: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  providerId!: string;

  @Column({ name: 'policy_version_id', type: 'uuid' })
  policyVersionId!: string;

  @Column({ name: 'policy_version', type: 'int' })
  policyVersion!: number;

  /** Copy of the settings at execution time; never re-resolved on read. */
  @Column({ name: 'resolved_settings', type: 'jsonb' })
  resolvedSettings!: ResolvedCopySettings;

  @CreateDateColumn({ name: 'executed_at', type: 'timestamp with time zone' })
  executedAt!: Date;
}
