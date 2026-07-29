import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type FlagType = 'boolean' | 'percentage' | 'userList' | 'abTest';

export interface FlagConfig {
  percentage?: number;
  userList?: string[];
  variants?: { name: string; percentage: number }[];
  /** When set, only these tenant IDs are eligible for this flag. */
  tenantAllowList?: string[];
}

@Entity('feature_flags')
export class FeatureFlag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  name!: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 20 })
  type!: FlagType;

  @Column({ default: false })
  enabled!: boolean;

  @Column({ type: 'jsonb', default: {} })
  config!: FlagConfig;

  /** When set, the flag only evaluates as enabled in these environments (e.g. ['staging']). Null/empty = all environments. */
  @Column({ type: 'simple-array', nullable: true })
  environments?: string[] | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
