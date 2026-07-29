import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SupportTeam } from './support-team.entity';

export enum RoutingRuleType {
  LANGUAGE = 'language',
  TIMEZONE = 'timezone',
  SKILL = 'skill',
  REGION = 'region',
  LOAD_BALANCE = 'load_balance',
}

@Entity('routing_rules')
@Index(['isActive', 'priority'])
@Index(['ruleType'])
export class RoutingRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'integer', default: 0 })
  priority!: number;

  @Column({ type: 'enum', enum: RoutingRuleType })
  ruleType!: RoutingRuleType;

  @Column({ type: 'jsonb', default: '{}' })
  conditions!: Record<string, unknown>;

  @Column({ type: 'uuid' })
  targetTeamId!: string;

  @ManyToOne(() => SupportTeam, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'target_team_id' })
  targetTeam!: SupportTeam;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
