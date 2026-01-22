import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ExpirationAction {
  AUTO_CLOSE = 'AUTO_CLOSE',
  NOTIFY_ONLY = 'NOTIFY_ONLY',
  EXTEND_GRACE_PERIOD = 'EXTEND_GRACE_PERIOD',
  DO_NOTHING = 'DO_NOTHING',
}

@Entity('user_expiration_preferences')
export class UserExpirationPreference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', unique: true })
  userId!: string;

  @Column({
    name: 'default_action',
    type: 'enum',
    enum: ExpirationAction,
    default: ExpirationAction.NOTIFY_ONLY,
  })
  defaultAction!: ExpirationAction;

  @Column({
    name: 'grace_period_minutes',
    type: 'int',
    default: 30,
  })
  gracePeriodMinutes!: number;

  @Column({
    name: 'notify_before_expiration_minutes',
    type: 'int',
    default: 60,
  })
  notifyBeforeExpirationMinutes!: number;

  @Column({
    name: 'notify_on_auto_close',
    type: 'boolean',
    default: true,
  })
  notifyOnAutoClose!: boolean;

  @Column({
    name: 'notify_on_grace_period_start',
    type: 'boolean',
    default: true,
  })
  notifyOnGracePeriodStart!: boolean;

  @Column({
    name: 'auto_close_at_loss_threshold',
    type: 'decimal',
    precision: 10,
    scale: 4,
    nullable: true,
  })
  autoCloseAtLossThreshold!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
