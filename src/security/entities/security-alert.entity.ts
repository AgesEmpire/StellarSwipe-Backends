import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

export enum AlertType {
  FAILED_LOGIN = 'FAILED_LOGIN',
  NEW_LOCATION = 'NEW_LOCATION',
  UNUSUAL_TRADE_VOLUME = 'UNUSUAL_TRADE_VOLUME',
  RAPID_WALLET_CHANGES = 'RAPID_WALLET_CHANGES',
  API_RATE_ABUSE = 'API_RATE_ABUSE',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  MULTIPLE_SESSIONS = 'MULTIPLE_SESSIONS',
}

@Entity('security_alerts')
@Index(['userId', 'createdAt'])
@Index(['severity', 'resolved'])
export class SecurityAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @Column({
    type: 'enum',
    enum: AlertType,
  })
  type: AlertType;

  @Column({
    type: 'enum',
    enum: AlertSeverity,
    default: AlertSeverity.INFO,
  })
  severity: AlertSeverity;

  @Column({ type: 'jsonb', default: {} })
  details: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  resolved: boolean;

  @Column({ type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  resolutionNote: string | null;

  @Column({ type: 'boolean', default: false })
  notificationSent: boolean;

  @Column({ type: 'boolean', default: false })
  falsePositive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
