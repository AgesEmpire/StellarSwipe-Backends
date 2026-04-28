import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ProfileSession } from './profile-session.entity';

export enum SnapshotType {
  CPU = 'cpu',
  MEMORY = 'memory',
  QUERY = 'query',
  API = 'api',
}

@Entity('performance_snapshots')
@Index(['sessionId', 'capturedAt'])
@Index(['sessionId', 'type'])
export class PerformanceSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sessionId: string;

  @Column({ type: 'enum', enum: SnapshotType })
  type: SnapshotType;

  @Column({ type: 'jsonb' })
  data: CpuSnapshot | MemorySnapshot | QuerySnapshot | ApiSnapshot;

  @Column({ type: 'float', nullable: true })
  valueNumeric: number;

  @Column({ type: 'boolean', default: false })
  isAnomaly: boolean;

  @Column({ type: 'text', nullable: true })
  anomalyReason: string;

  @Column({ type: 'timestamptz' })
  capturedAt: Date;

  @ManyToOne(() => ProfileSession, (session) => session.snapshots, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sessionId' })
  session: ProfileSession;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

// ─── Snapshot payload shapes ───────────────────────────────────────────────

export interface CpuSnapshot {
  usagePercent: number;
  userTimeMs: number;
  systemTimeMs: number;
  idlePercent: number;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  cores: number;
  perCoreUsage?: number[];
}

export interface MemorySnapshot {
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  rssMs: number;
  arrayBuffersMb: number;
  heapUsagePercent: number;
  gcCount?: number;
  gcDurationMs?: number;
  heapGrowthRateMbPerSec?: number;
}

export interface QuerySnapshot {
  query: string;
  durationMs: number;
  rowsExamined?: number;
  rowsReturned?: number;
  isSlow: boolean;
  queryHash: string;
  table?: string;
  operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'OTHER';
  explain?: Record<string, any>;
}

export interface ApiSnapshot {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  requestSizeBytes?: number;
  responseSizeBytes?: number;
  userId?: string;
  traceId?: string;
}
