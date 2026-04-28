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
] as const;

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

  @Column({ default: true })
  active!: boolean;

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
