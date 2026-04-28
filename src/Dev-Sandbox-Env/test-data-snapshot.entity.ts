import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { SandboxEnvironment } from './sandbox-environment.entity';

export enum SnapshotType {
  MANUAL = 'manual',
  PRE_RESET = 'pre_reset',
  SCHEDULED = 'scheduled',
  SEEDED = 'seeded',
}

export interface SnapshotTableEntry {
  tableName: string;
  rowCount: number;
  checksum: string;
}

export interface StellarSnapshot {
  accounts: Array<{
    publicKey: string;
    balance: string;
    sequence: string;
  }>;
  transactions: Array<Record<string, unknown>>;
}

@Entity('test_data_snapshots')
@Index(['environmentId', 'createdAt'])
@Index(['environmentId', 'type'])
export class TestDataSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  environmentId: string;

  @ManyToOne(() => SandboxEnvironment, (env) => env.snapshots, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'environmentId' })
  environment: SandboxEnvironment;

  @Column({ type: 'varchar', length: 100 })
  label: string;

  @Column({
    type: 'enum',
    enum: SnapshotType,
    default: SnapshotType.MANUAL,
  })
  type: SnapshotType;

  /** Per-table row counts and checksums */
  @Column({ type: 'jsonb', default: '[]' })
  tables: SnapshotTableEntry[];

  /** Captured Stellar testnet state */
  @Column({ type: 'jsonb', nullable: true })
  stellarState: StellarSnapshot | null;

  /** Gzipped SQL dump stored as base64 or S3 key */
  @Column({ type: 'text', nullable: true })
  dumpReference: string | null;

  /** Human-readable diff from previous snapshot */
  @Column({ type: 'jsonb', nullable: true })
  diffFromPrevious: Record<string, unknown> | null;

  @Column({ type: 'integer', default: 0 })
  totalRows: number;

  /** Whether this snapshot can be used as a restore point */
  @Column({ type: 'boolean', default: true })
  isRestorable: boolean;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdByUserId: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
