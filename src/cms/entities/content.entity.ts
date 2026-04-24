import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Translation } from './translation.entity';
import { ContentVersion } from './content-version.entity';

export enum ContentType {
  HELP_DOC = 'help_doc',
  TUTORIAL = 'tutorial',
  NOTIFICATION = 'notification',
  LEGAL = 'legal',
  MARKETING = 'marketing',
}

export enum ContentStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

@Entity('cms_contents')
@Index(['slug'], { unique: true })
@Index(['type', 'status'])
export class Content {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 255 })
  slug!: string;

  @Column({ length: 255 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'enum', enum: ContentType })
  type!: ContentType;

  @Column({ type: 'enum', enum: ContentStatus, default: ContentStatus.DRAFT })
  status!: ContentStatus;

  @Column({ name: 'default_locale', length: 10, default: 'en' })
  defaultLocale!: string;

  @Column({ name: 'author_id', type: 'uuid' })
  authorId!: string;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  publishedAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @OneToMany(() => Translation, (t) => t.content, { cascade: true })
  translations!: Translation[];

  @OneToMany(() => ContentVersion, (v) => v.content, { cascade: true })
  versions!: ContentVersion[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
