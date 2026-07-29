import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum TenantUsageType {
  API_CALLS = 'api_calls',
  SIGNAL_SUBMISSIONS = 'signal_submissions',
  STORAGE = 'storage',
}

@Entity('tenant_usage')
@Index(['tenantId', 'usageType', 'recordedAt'])
export class TenantUsage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 50 })
  usageType!: TenantUsageType;

  @Column({ type: 'double precision', default: 0 })
  used!: number;

  @Column({ type: 'double precision', default: 0 })
  quota!: number;

  @Column({ type: 'varchar', length: 32, default: 'count' })
  unit!: string;

  @Column({ type: 'timestamp' })
  periodStart!: Date;

  @Column({ type: 'timestamp' })
  periodEnd!: Date;

  @Index()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  recordedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
