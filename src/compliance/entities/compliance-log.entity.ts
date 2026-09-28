import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('compliance_logs')
export class ComplianceLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  type!: 'access_blocked' | 'access_allowed' | 'sanctions_hit' | 'transaction_blocked' | 'transaction_allowed';

  @Column({ name: 'ip_address', type: 'varchar', length: 45 })
  ipAddress!: string;

  @Column({ name: 'country_code', type: 'varchar', length: 2, nullable: true })
  countryCode?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  path?: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  method?: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string;

  @Column({ name: 'wallet_address', type: 'varchar', length: 100, nullable: true })
  walletAddress?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}