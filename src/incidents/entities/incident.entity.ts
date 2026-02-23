import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum IncidentSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum IncidentStatus {
  INVESTIGATING = 'investigating',
  IDENTIFIED = 'identified',
  MONITORING = 'monitoring',
  RESOLVED = 'resolved',
}

@Entity('incidents')
export class Incident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column('text')
  description: string;

  @Column({ type: 'enum', enum: IncidentSeverity })
  severity: IncidentSeverity;

  @Column({ type: 'enum', enum: IncidentStatus, default: IncidentStatus.INVESTIGATING })
  status: IncidentStatus;

  @Column('jsonb', { default: [] })
  timeline: Array<{ timestamp: Date; status: string; message: string }>;

  @Column('text', { nullable: true })
  postMortem: string;

  @Column({ default: false })
  publishedToStatusPage: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  resolvedAt: Date;
}
