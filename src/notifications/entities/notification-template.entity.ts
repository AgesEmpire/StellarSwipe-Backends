import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum NotificationChannel {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  IN_APP = 'IN_APP',
  PUSH = 'PUSH',
}

@Entity('notification_templates')
export class NotificationTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column('text')
  description: string;

  @Column()
  key: string; // Unique identifier like 'trade-executed', 'low-balance-alert'

  // Email content
  @Column({ nullable: true })
  emailSubject: string;

  @Column('text', { nullable: true })
  emailBody: string; // HTML template with {{variable}} placeholders

  @Column('text', { nullable: true })
  emailPlainText: string; // Fallback plain text

  // SMS content
  @Column('text', { nullable: true })
  smsBody: string; // {{variable}} placeholders, max 160 chars recommended

  // In-app notification
  @Column({ nullable: true })
  inAppTitle: string;

  @Column('text', { nullable: true })
  inAppBody: string;

  // Push notification
  @Column({ nullable: true })
  pushTitle: string;

  @Column('text', { nullable: true })
  pushBody: string;

  // Fallback content if template is not found
  @Column({ nullable: true })
  fallbackTitle: string;

  @Column('text', { nullable: true })
  fallbackMessage: string;

  // Active status
  @Column({ default: true })
  isActive: boolean;

  // Supported variables (e.g., ['userName', 'amount', 'tradeId'])
  @Column('simple-array', { default: [] })
  variables: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
