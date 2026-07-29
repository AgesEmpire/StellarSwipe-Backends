import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum RegionFlagStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SCHEDULED = 'scheduled',
}

@Entity('regional_flag_configs')
@Index(['flagName', 'region'], { unique: true })
@Index(['region'])
@Index(['flagName'])
export class RegionalFlagConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  flagName!: string;

  @Column({ type: 'varchar', length: 10 })
  region!: string;

  @Column({ default: false })
  enabled!: boolean;

  @Column({ type: 'enum', enum: RegionFlagStatus, default: RegionFlagStatus.ACTIVE })
  status!: RegionFlagStatus;

  @Column({ type: 'jsonb', default: '{}' })
  overrides!: Record<string, unknown>;

  @Column({ type: 'timestamp with time zone', nullable: true })
  enabledAt!: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  disabledAt!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
