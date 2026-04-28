import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { TestDataSnapshot } from './test-data-snapshot.entity';

export enum SandboxStatus {
  INITIALIZING = 'initializing',
  ACTIVE = 'active',
  RESETTING = 'resetting',
  SUSPENDED = 'suspended',
  DESTROYED = 'destroyed',
}

export enum SandboxTier {
  BASIC = 'basic',
  STANDARD = 'standard',
  FULL = 'full',
}

@Entity('sandbox_environments')
@Index(['ownerId', 'status'])
@Index(['name'], { unique: true })
export class SandboxEnvironment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  ownerId: string;

  @Column({
    type: 'enum',
    enum: SandboxStatus,
    default: SandboxStatus.INITIALIZING,
  })
  status: SandboxStatus;

  @Column({
    type: 'enum',
    enum: SandboxTier,
    default: SandboxTier.STANDARD,
  })
  tier: SandboxTier;

  @Column({ type: 'varchar', length: 100, nullable: true })
  description: string | null;

  /** Stellar testnet keypair for this sandbox */
  @Column({ type: 'varchar', length: 56, nullable: true })
  stellarPublicKey: string | null;

  @Column({ type: 'text', nullable: true, select: false })
  stellarSecretKey: string | null;

  /** Internal DB schema prefix for isolation e.g. "sbx_abc123_" */
  @Column({ type: 'varchar', length: 30, unique: true })
  schemaPrefix: string;

  /** Seed configuration snapshot reference */
  @Column({ type: 'uuid', nullable: true })
  activeSnapshotId: string | null;

  /** Feature flags active in this sandbox */
  @Column({ type: 'jsonb', default: '{}' })
  featureFlags: Record<string, boolean>;

  /** Mock overrides (provider -> mock config) */
  @Column({ type: 'jsonb', default: '{}' })
  mockConfig: Record<string, unknown>;

  /** Tracks cumulative reset count */
  @Column({ type: 'integer', default: 0 })
  resetCount: number;

  @Column({ type: 'timestamp', nullable: true })
  lastResetAt: Date | null;

  /** TTL in seconds; null = no expiry */
  @Column({ type: 'integer', nullable: true })
  ttlSeconds: number | null;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'jsonb', default: '{}' })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => TestDataSnapshot, (s) => s.environment, { cascade: false })
  snapshots: TestDataSnapshot[];
}
