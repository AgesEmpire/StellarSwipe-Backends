import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type WebhookReplayOutcome = 'queued' | 'denied' | 'duplicate';

/**
 * Append-only record of a manually initiated webhook replay. Rows are never
 * updated or deleted; the database rejects both via a trigger.
 */
@Entity('webhook_replay_audits')
@Index(['originalDeliveryId', 'targetWebhookId', 'createdAt'])
export class WebhookReplayAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  requestedBy!: string;

  @Column({ type: 'uuid' })
  originalDeliveryId!: string;

  @Index()
  @Column({ type: 'uuid' })
  targetWebhookId!: string;

  @Column({ type: 'uuid', nullable: true })
  replayDeliveryId?: string;

  @Column({ type: 'varchar', length: 20 })
  outcome!: WebhookReplayOutcome;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
