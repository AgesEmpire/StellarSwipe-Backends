import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Content } from './content.entity';

export enum TranslationStatus {
  PENDING = 'pending',
  IN_REVIEW = 'in_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('cms_translations')
@Index(['contentId', 'locale'], { unique: true })
@Index(['locale', 'status'])
export class Translation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'content_id', type: 'uuid' })
  contentId!: string;

  @ManyToOne(() => Content, (c) => c.translations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'content_id' })
  content!: Content;

  @Column({ length: 10 })
  locale!: string;

  @Column({ length: 255 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'enum', enum: TranslationStatus, default: TranslationStatus.PENDING })
  status!: TranslationStatus;

  @Column({ name: 'translator_id', type: 'uuid', nullable: true })
  translatorId?: string;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy?: string;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
