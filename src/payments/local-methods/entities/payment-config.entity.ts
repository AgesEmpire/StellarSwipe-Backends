import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('local_payment_configs')
@Index(['provider', 'country'], { unique: true })
export class PaymentConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 50 })
  provider!: string;

  @Column({ length: 2 })
  country!: string;

  @Column({ name: 'is_enabled', default: true })
  isEnabled!: boolean;

  @Column({ name: 'min_amount', type: 'decimal', precision: 18, scale: 2, default: 0 })
  minAmount!: string;

  @Column({ name: 'max_amount', type: 'decimal', precision: 18, scale: 2, nullable: true })
  maxAmount?: string;

  @Column({ type: 'jsonb', nullable: true })
  settings?: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
