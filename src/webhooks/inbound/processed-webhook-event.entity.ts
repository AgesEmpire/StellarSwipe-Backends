import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('processed_webhook_events')
@Index(['source', 'deliveryId'], { unique: true })
export class ProcessedWebhookEvent {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  source: string;

  @PrimaryColumn({ name: 'delivery_id', type: 'varchar', length: 255 })
  deliveryId: string;

  @Column({ name: 'event_timestamp', type: 'timestamptz' })
  eventTimestamp: Date;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt: Date;
}
