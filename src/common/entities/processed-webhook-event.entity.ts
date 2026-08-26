import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from 'typeorm';

/**
 * Records every external webhook delivery that has been processed, keyed by
 * (provider, eventId). Used to make webhook handlers idempotent against
 * retried/duplicate deliveries from providers like Stripe, M-Pesa, Paystack.
 */
@Entity('processed_webhook_events')
@Unique(['provider', 'eventId'])
export class ProcessedWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  provider!: string;

  @Column()
  eventId!: string;

  @CreateDateColumn()
  processedAt!: Date;
}
