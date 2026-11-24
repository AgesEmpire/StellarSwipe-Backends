import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type WebhookStateAction = 'paused' | 'resumed';

/**
 * Append-only record of endpoint pause/resume transitions. Rows are never
 * updated or deleted; the database rejects both via a trigger.
 */
@Entity('webhook_state_audits')
export class WebhookStateAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  requestedBy!: string;

  @Index()
  @Column({ type: 'uuid' })
  webhookId!: string;

  @Column({ type: 'varchar', length: 20 })
  action!: WebhookStateAction;

  @CreateDateColumn()
  createdAt!: Date;
}
