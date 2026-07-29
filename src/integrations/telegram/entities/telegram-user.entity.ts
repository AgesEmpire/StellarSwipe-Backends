import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('telegram_users')
export class TelegramUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'bigint' })
  telegramId: number;

  @Column({ nullable: true })
  username: string;

  @Column({ nullable: true })
  firstName: string;

  @Column({ nullable: true })
  userId: string; // linked app user

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
