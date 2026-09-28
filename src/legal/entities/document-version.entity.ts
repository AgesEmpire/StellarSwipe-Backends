import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { LegalDocument } from './legal-document.entity';

@Entity('document_versions')
@Index(['documentId', 'version'], { unique: true })
@Index(['documentId', 'isActive'])
export class DocumentVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  documentId!: string;

  @ManyToOne(() => LegalDocument, (d) => d.versions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document!: LegalDocument;

  @Column({ type: 'varchar', length: 20 })
  version!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'varchar', length: 64 })
  contentHash!: string;

  @Column({ type: 'text', nullable: true })
  changelog!: string | null;

  @Column({ default: false })
  isActive!: boolean;

  @Column({ type: 'boolean', default: false })
  requiresReacceptance!: boolean;

  @Column({ type: 'timestamp with time zone', nullable: true })
  publishedAt!: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  publishedBy!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
