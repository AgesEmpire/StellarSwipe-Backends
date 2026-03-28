import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Competition } from './competition.entity';

@Entity('competition_prize_pools')
export class PrizePool {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'total_amount', type: 'decimal', precision: 24, scale: 8, default: '0' })
  totalAmount!: string;

  @Column({ length: 16, default: 'USDC' })
  currency!: string;

  @Column({ name: 'distribution_rules_json', type: 'jsonb', default: () => "'[]'" })
  distributionRulesJson!: unknown;

  @Column({ name: 'distributed_at', type: 'timestamp with time zone', nullable: true })
  distributedAt?: Date | null;

  @OneToOne(() => Competition, (c) => c.prizePool, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'competition_id' })
  competition!: Competition;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
