import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type FlagType = 'boolean' | 'percentage' | 'userList' | 'abTest';

export interface FlagConfig {
  percentage?: number;
  userList?: string[];
  variants?: { name: string; percentage: number }[];
}

@Entity('feature_flags')
export class FeatureFlag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  @Index('idx_feature_flag_name')
  name!: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 20 })
  type!: FlagType;

  @Column({ default: false })
  enabled!: boolean;

  @Column({ type: 'jsonb', default: {} })
  config!: FlagConfig;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
