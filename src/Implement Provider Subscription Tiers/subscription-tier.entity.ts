import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';

@Entity('subscription_tiers')
export class SubscriptionTier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'provider_id' })
  providerId: string;

  @Column()
  name: string;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number; // monthly in USDC

  @Column('simple-array')
  benefits: string[];

  @Column({ name: 'signal_limit', type: 'int', nullable: true })
  signalLimit: number | null; // null = unlimited

  @Column({ default: true })
  active: boolean;

  @Column('decimal', { precision: 5, scale: 2, name: 'platform_commission', default: 20 })
  platformCommission: number; // percentage (default 20%)

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
