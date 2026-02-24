import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('two_factor_auth')
export class TwoFactor {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'text' })
  secret!: string; // AES-256-GCM encrypted TOTP secret

  @Column({ type: 'simple-array' })
  backupCodes!: string[]; // bcrypt-hashed one-time codes

  @Column({ default: false })
  enabled!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  enabledAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
