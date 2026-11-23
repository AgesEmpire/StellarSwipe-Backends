import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { SignalCategory } from '../../signals/entities/signal.entity';

/**
 * One row per user holding the set of muted signal categories (#1516).
 * `version` is a compare-and-set token: every write is an UPDATE guarded by
 * `WHERE version = :expected`, so concurrent updates never silently interleave.
 */
@Entity('user_signal_category_preferences')
@Unique('uq_user_signal_category_preferences_user', ['userId'])
export class UserSignalCategoryPreference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'muted_categories', type: 'text', array: true, default: '{}' })
  mutedCategories!: SignalCategory[];

  @Column({ name: 'version', type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
