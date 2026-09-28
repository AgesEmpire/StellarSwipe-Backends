import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DataRegion } from './data-region.entity';

export enum PolicyType {
  GDPR = 'GDPR',
  CCPA = 'CCPA',
  CHINA_CSL = 'CHINA_CSL',
  PDPA = 'PDPA',
  CUSTOM = 'CUSTOM',
}

export enum PolicyStatus {
  ACTIVE = 'active',
  DRAFT = 'draft',
  DEPRECATED = 'deprecated',
}

@Entity('residency_policies')
export class ResidencyPolicy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  policyType: PolicyType;

  @Column({ type: 'varchar', length: 20, default: PolicyStatus.ACTIVE })
  status: PolicyStatus;

  @ManyToOne(() => DataRegion, { nullable: false, eager: true })
  @JoinColumn({ name: 'region_id' })
  region: DataRegion;

  @Column({ type: 'uuid' })
  regionId: string;

  @Column({ type: 'boolean', default: true })
  dataLocalizationRequired: boolean;

  @Column({ type: 'boolean', default: false })
  crossBorderTransferAllowed: boolean;

  @Column({ type: 'simple-array', nullable: true })
  allowedTransferDestinations: string[];

  @Column({ type: 'int', default: 730 })
  retentionDays: number;

  @Column({ type: 'boolean', default: true })
  encryptionRequired: boolean;

  @Column({ type: 'jsonb', nullable: true })
  additionalRequirements: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
