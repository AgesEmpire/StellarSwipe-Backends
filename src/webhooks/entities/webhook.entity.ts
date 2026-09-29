import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { WebhookDelivery } from './webhook-delivery.entity';

export const SUPPORTED_WEBHOOK_EVENTS = [
  'trade.executed',
  'trade.failed',
  'trade.cancelled',
  'signal.created',
  'signal.validated',
  'signal.performance.updated',
  'contest.updated',
  'payout.completed',
  'payment.stellar.received',
  'payment.stellar.sent',
  'payment.stellar.failed',
] as const;

export const STELLAR_PAYMENT_EVENTS = [
  'payment.stellar.received',
  'payment.stellar.sent',
  'payment.stellar.failed',
] as const satisfies ReadonlyArray<(typeof SUPPORTED_WEBHOOK_EVENTS)[number]>;

export type WebhookEventType = (typeof SUPPORTED_WEBHOOK_EVENTS)[number];

@Entity('webhooks')
export class Webhook {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 2048 })
  url!: string;

  @Column({ type: 'simple-array' })
  events!: string[];

  @Column({ type: 'varchar', length: 255 })
  secret!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nextSecret?: string;

  @Column({ type: 'timestamp', nullable: true })
  rotationStartedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  rotationFinalizesAt?: Date;

  @Column({ default: true })
  active!: boolean;

  /** Destination awaiting ownership verification; not used for deliveries. */
  @Column({ type: 'varchar', length: 2048, nullable: true })
  pendingUrl?: string | null;

  /** SHA-256 of the outstanding verification token, scoped to id + pendingUrl. */
  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  verificationTokenHash?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  verificationTokenExpiresAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  urlVerifiedAt?: Date | null;

  @Column({ default: 0 })
  consecutiveFailures!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => WebhookDelivery, (delivery) => delivery.webhook, {
    cascade: false,
  })
  deliveries!: WebhookDelivery[];
}
