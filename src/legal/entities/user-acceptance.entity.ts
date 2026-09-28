import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { LegalDocument } from './legal-document.entity';
import { DocumentVersion } from './document-version.entity';

@Entity('user_acceptances')
@Index(['userId', 'documentId'])
@Index(['userId', 'versionId'])
@Index(['documentId', 'versionId'])
export class UserAcceptance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'uuid' })
  documentId!: string;

  @ManyToOne(() => LegalDocument, (d) => d.acceptances, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document!: LegalDocument;

  @Column({ type: 'uuid' })
  versionId!: string;

  @ManyToOne(() => DocumentVersion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'version_id' })
  version!: DocumentVersion;

  @Column({ type: 'varchar', length: 50, nullable: true })
  ipAddress!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  userAgent!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  region!: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @CreateDateColumn()
  acceptedAt!: Date;
}
