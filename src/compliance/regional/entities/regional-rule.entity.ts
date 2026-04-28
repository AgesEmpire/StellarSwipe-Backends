import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ComplianceRegion, RuleCategory, RuleSeverity } from '../interfaces/compliance-framework.interface';

@Entity('regional_compliance_rules')
@Index(['region', 'isActive'])
@Index(['category', 'region'])
export class RegionalRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 50 })
  ruleCode!: string;

  @Column({ length: 255 })
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'enum', enum: ComplianceRegion })
  region!: ComplianceRegion;

  @Column({ type: 'enum', enum: RuleCategory })
  category!: RuleCategory;

  @Column({ type: 'enum', enum: RuleSeverity, default: RuleSeverity.MEDIUM })
  severity!: RuleSeverity;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
