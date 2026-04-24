import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ComplianceRegion } from '../interfaces/compliance-framework.interface';

@Entity('compliance_checks')
@Index(['userId', 'region'])
@Index(['passed', 'region'])
@Index(['createdAt'])
export class ComplianceCheck {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'enum', enum: ComplianceRegion })
  region!: ComplianceRegion;

  @Column({ length: 100 })
  action!: string;

  @Column({ default: false })
  passed!: boolean;

  @Column({ name: 'checked_rules', type: 'jsonb', default: '[]' })
  checkedRules!: string[];

  @Column({ type: 'jsonb', default: '[]' })
  violations!: Record<string, any>[];

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress?: string;

  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
