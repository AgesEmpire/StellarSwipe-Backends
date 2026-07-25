import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * TestUncoveredEntity
 *
 * A test fixture entity used to verify that the soft-delete audit job
 * correctly detects soft-deletable entities without retention rules.
 *
 * This entity intentionally:
 * - Has @DeleteDateColumn to enable soft-delete
 * - Is NOT included in SoftDeleteAuditJob's retention rules
 *
 * The soft-delete audit should flag this entity as UNCOVERED and the
 * audit job should fail, alerting that a new soft-deletable entity
 * needs a retention rule defined.
 *
 * Usage in tests:
 *   - Add this entity to the DataSource in test setup
 *   - Run the soft-delete audit job
 *   - Verify that the audit fails with this entity listed as uncovered
 *   - Then add a retention rule in SoftDeleteAuditJob.getRetentionRules()
 */
@Entity('test_uncovered_soft_delete_entity')
export class TestUncoveredEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  testData: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt?: Date;
}
