import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { ProviderContent } from './provider-content.entity';

export enum EngagementType {
  VIEW = 'view',
  LIKE = 'like',
  SHARE = 'share',
  FLAG = 'flag',
}

@Entity('content_engagement')
@Unique(['contentId', 'userId', 'type'])
@Index(['contentId', 'type'])
@Index(['userId'])
export class ContentEngagement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  contentId: string;

  @Column()
  userId: string;

  @Column({
    type: 'enum',
    enum: EngagementType,
  })
  type: EngagementType;

  @Column({ nullable: true })
  flagReason: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => ProviderContent, (content) => content.engagements, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'contentId' })
  content: ProviderContent;
}
