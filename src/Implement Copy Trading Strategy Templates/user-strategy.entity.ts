import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StrategyTemplate } from './strategy-template.entity';

export class PerformanceMetrics {
  totalSignalsReceived: number = 0;
  signalsFiltered: number = 0;
  signalsExecuted: number = 0;
  profitableTrades: number = 0;
  totalPnl: number = 0;
  winRate: number = 0;
  avgReturnPerTrade: number = 0;
  maxDrawdown: number = 0;
  sharpeRatio: number = 0;
}

@Entity('user_strategies')
export class UserStrategy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  templateId: string;

  @ManyToOne(() => StrategyTemplate, (t) => t.userStrategies, { eager: true })
  @JoinColumn({ name: 'templateId' })
  template: StrategyTemplate;

  @Column({ default: true })
  isActive: boolean;

  @Column('jsonb', { nullable: true })
  customOverrides: Partial<StrategyTemplate['parameters']>;

  @Column('jsonb', { default: () => "'{}'::jsonb" })
  performanceMetrics: PerformanceMetrics;

  @Column({ nullable: true })
  appliedAt: Date;

  @Column({ nullable: true })
  deactivatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
