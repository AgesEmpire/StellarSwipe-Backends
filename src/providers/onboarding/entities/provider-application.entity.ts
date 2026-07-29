import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ApplicationStatus {
  PENDING = 'PENDING',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity('provider_applications')
@Index(['providerId', 'status'])
export class ProviderApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'provider_id' })
  @Index()
  providerId: string;

  @Column({ name: 'display_name', length: 255 })
  displayName: string;

  @Column({ type: 'text' })
  bio: string;

  @Column({ name: 'trading_experience_years', type: 'int' })
  tradingExperienceYears: number;

  @Column({ name: 'document_urls', type: 'jsonb' })
  documentUrls: string[];

  @Column({ name: 'website_url', length: 500, nullable: true })
  websiteUrl?: string;

  @Column({ name: 'social_links', type: 'jsonb', nullable: true })
  socialLinks?: Record<string, string>;

  @Column({
    type: 'enum',
    enum: ApplicationStatus,
    default: ApplicationStatus.PENDING,
  })
  @Index()
  status: ApplicationStatus;

  @CreateDateColumn({ name: 'submitted_at' })
  submittedAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
