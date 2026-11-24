import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A single field change captured by an amendment: the value before and the value requested. */
export interface RevisionFieldChange {
  previous: unknown;
  requested: unknown;
}

/**
 * Append-only record of one accepted amendment to a conditional order (#1529).
 *
 * Rows are never updated or deleted (enforced by a DB trigger, see migration
 * 20261123180000). Only amendments that were actually applied produce a row:
 * a rejected amendment rolls back with the order update, so no revision ever
 * describes a change that did not happen.
 */
@Entity('conditional_order_revisions')
@Index('UQ_conditional_order_revisions_order_revision', ['orderId', 'revisionNumber'], { unique: true })
export class ConditionalOrderRevision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  /** 1-based, gap-free per order. Revision 0 is the order as originally created. */
  @Column({ name: 'revision_number', type: 'int' })
  revisionNumber!: number;

  @Column({ name: 'actor_id', type: 'varchar', length: 128 })
  actorId!: string;

  @Column({ name: 'actor_roles', type: 'jsonb', default: () => "'[]'" })
  actorRoles!: string[];

  @Column({ type: 'text' })
  reason!: string;

  /** Only the fields whose value actually changed, with before/requested values. */
  @Column({ name: 'changed_fields', type: 'jsonb' })
  changedFields!: Record<string, RevisionFieldChange>;

  /** Every value the caller asked for, including ones equal to the current value. */
  @Column({ name: 'requested_values', type: 'jsonb' })
  requestedValues!: Record<string, unknown>;

  @Column({ name: 'order_version_before', type: 'int' })
  orderVersionBefore!: number;

  @Column({ name: 'order_version_after', type: 'int' })
  orderVersionAfter!: number;

  /** When the amendment was accepted (UTC). */
  @Column({ name: 'amended_at', type: 'timestamptz' })
  amendedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
