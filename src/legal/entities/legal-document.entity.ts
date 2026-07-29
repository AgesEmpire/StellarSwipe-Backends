import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { DocumentVersion } from './document-version.entity';
import { UserAcceptance } from './user-acceptance.entity';

export enum DocumentType {
  TERMS_OF_SERVICE = 'terms_of_service',
  PRIVACY_POLICY = 'privacy_policy',
  DISCLAIMER = 'disclaimer',
  COOKIE_POLICY = 'cookie_policy',
  RISK_DISCLOSURE = 'risk_disclosure',
}

export enum DocumentStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

@Entity('legal_documents')
@Index(['type', 'region', 'language'], { unique: true })
@Index(['region'])
@Index(['type'])
export class LegalDocument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'enum', enum: DocumentType })
  type!: DocumentType;

  @Column({ type: 'varchar', length: 10 })
  region!: string;

  @Column({ type: 'varchar', length: 10, default: 'en' })
  language!: string;

  @Column({ type: 'enum', enum: DocumentStatus, default: DocumentStatus.ACTIVE })
  status!: DocumentStatus;

  @Column({ type: 'uuid', nullable: true })
  currentVersionId!: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @OneToMany(() => DocumentVersion, (v) => v.document, { cascade: true })
  versions!: DocumentVersion[];

  @OneToMany(() => UserAcceptance, (a) => a.document)
  acceptances!: UserAcceptance[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
