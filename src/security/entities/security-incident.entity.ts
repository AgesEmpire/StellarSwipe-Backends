import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { SecurityAlert } from './security-alert.entity';

export enum IncidentStatus {
  OPEN = 'open',
  INVESTIGATING = 'investigating',
  CONTAINED = 'contained',
  RESOLVED = 'resolved',
  FALSE_POSITIVE = 'false_positive',
}

export enum IncidentSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

@Entity('security_incidents')
@Index(['userId', 'status'])
@Index(['status', 'severity'])
export class SecurityIncident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: IncidentStatus,
    default: IncidentStatus.OPEN,
  })
  status: IncidentStatus;

  @Column({
    type: 'enum',
    enum: IncidentSeverity,
    default: IncidentSeverity.MEDIUM,
  })
  severity: IncidentSeverity;

  @Column({ type: 'jsonb', default: [] })
  alertIds: string[];

  @Column({ type: 'jsonb', default: [] })
  timeline: IncidentTimelineEntry[];

  @Column({ type: 'uuid', nullable: true })
  assignedTo: string | null;

  @Column({ type: 'boolean', default: false })
  accountLocked: boolean;

  @Column({ type: 'boolean', default: false })
  requires2FAReeset: boolean;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

export interface IncidentTimelineEntry {
  timestamp: Date;
  action: string;
  actor: string;
  details?: Record<string, unknown>;
}
