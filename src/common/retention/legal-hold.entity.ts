import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * A legal hold exempts records from retention deletion while it is active.
 *
 * Scope: one tenant, one retention policy, and either a single record
 * (`recordId`) or every record the policy covers for that tenant (`recordId`
 * null). Several holds may overlap on the same record; the record stays
 * protected until every overlapping hold is released or has expired.
 */
@Entity('legal_holds')
@Index(['tenantId', 'policyName'])
export class LegalHold {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'policy_name', type: 'varchar', length: 100 })
  policyName!: string;

  @Column({ name: 'record_id', type: 'varchar', length: 64, nullable: true })
  recordId?: string | null;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ name: 'created_by', type: 'varchar', length: 36 })
  createdBy!: string;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt?: Date | null;

  @Column({ name: 'released_at', type: 'timestamp', nullable: true })
  releasedAt?: Date | null;

  @Column({ name: 'released_by', type: 'varchar', length: 36, nullable: true })
  releasedBy?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
