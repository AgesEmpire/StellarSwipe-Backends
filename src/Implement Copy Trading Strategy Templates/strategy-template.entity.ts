import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { UserStrategy } from './user-strategy.entity';

export type RiskLevel = 'conservative' | 'balanced' | 'aggressive';

export class StrategyParameters {
  minProviderReputation: number;
  maxOpenPositions: number;
  defaultStopLoss: number;
  minSignalConfidence: number;
  preferredAssets: string[];
  maxPositionSize: number;
}

@Entity('strategy_templates')
export class StrategyTemplate {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column('text')
  description: string;

  @Column({ type: 'varchar' })
  riskLevel: RiskLevel;

  @Column('jsonb')
  parameters: StrategyParameters;

  @Column({ default: false })
  isCustom: boolean;

  @Column({ nullable: true })
  createdBy?: string;

  @OneToMany(() => UserStrategy, (us) => us.template, { lazy: true })
  userStrategies?: UserStrategy[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
