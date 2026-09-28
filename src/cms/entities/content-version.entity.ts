import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Content } from './content.entity';

@Entity('cms_content_versions')
@Index(['contentId', 'version'])
export class ContentVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'content_id', type: 'uuid' })
  contentId!: string;

  @ManyToOne(() => Content, (c) => c.versions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'content_id' })
  content!: Content;

  @Column({ type: 'int' })
  version!: number;

  @Column({ length: 255 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ name: 'changed_by', type: 'uuid' })
  changedBy!: string;

  @Column({ type: 'text', nullable: true })
  changeNotes?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
