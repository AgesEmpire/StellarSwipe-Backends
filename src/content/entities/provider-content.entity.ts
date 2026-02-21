import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { ContentEngagement } from './content-engagement.entity';

export enum ContentType {
  ARTICLE = 'article',
  VIDEO = 'video',
  ANALYSIS = 'analysis',
}

export enum ContentStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  FLAGGED = 'flagged',
  REMOVED = 'removed',
}

@Entity('provider_content')
@Index(['providerId', 'published'])
@Index(['type', 'published'])
@Index(['createdAt'])
export class ProviderContent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  providerId: string;

  @Column({
    type: 'enum',
    enum: ContentType,
  })
  type: ContentType;

  @Column()
  title: string;

  @Column('text')
  body: string; // markdown for articles, embed URL for videos

  @Column('simple-array', { default: '' })
  tags: string[];

  @Column({ default: false })
  published: boolean;

  @Column({
    type: 'enum',
    enum: ContentStatus,
    default: ContentStatus.DRAFT,
  })
  status: ContentStatus;

  @Column({ default: 0 })
  views: number;

  @Column({ default: 0 })
  likes: number;

  @Column({ default: 0 })
  shares: number;

  @Column({ nullable: true })
  thumbnailUrl: string;

  @Column({ nullable: true })
  videoUrl: string; // YouTube, Vimeo embed URL

  @Column({ nullable: true })
  flagReason: string;

  @Column({ nullable: true })
  moderatorNotes: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ContentEngagement, (engagement) => engagement.content)
  engagements: ContentEngagement[];
}
