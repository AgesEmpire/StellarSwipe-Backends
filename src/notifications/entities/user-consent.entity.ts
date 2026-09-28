import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

export enum ConsentCategory {
  MARKETING_EMAIL = 'marketing_email',
  MARKETING_PUSH = 'marketing_push',
}

@Index('idx_user_consent_user_category', ['userId', 'category'], { unique: true })
@Entity('user_consents')
export class UserConsent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'enum', enum: ConsentCategory })
  category!: ConsentCategory;

  @Column({ name: 'opted_in', type: 'boolean', default: false })
  optedIn!: boolean;

  @Column({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
