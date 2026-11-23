import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { CloseAllPositionResult } from './close-all.types';

/**
 * One confirmed close-all request (#1537). The unique preview_id makes
 * confirmation idempotent: a repeated or concurrent confirm of the same
 * preview returns this row instead of closing positions again.
 */
@Entity('close_all_confirmations')
@Index('UQ_close_all_confirmations_preview', ['previewId'], { unique: true })
@Index('IDX_close_all_confirmations_user', ['userId', 'createdAt'])
export class CloseAllConfirmation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'preview_id', type: 'uuid' })
  previewId!: string;

  @Column({ type: 'varchar', length: 64 })
  fingerprint!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: 'executing' | 'completed' | 'completed_with_failures';

  /** [positionId, version] pairs that were confirmed for closing. */
  @Column({ type: 'jsonb' })
  positions!: Array<[string, number]>;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  results!: CloseAllPositionResult[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date | null;
}
