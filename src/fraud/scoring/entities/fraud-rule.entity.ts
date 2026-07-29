import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum FraudRuleType {
  VELOCITY = 'velocity',
  AMOUNT = 'amount',
  LOCATION = 'location',
  PATTERN = 'pattern',
}

@Entity('fraud_rules')
export class FraudRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 100 })
  name!: string;

  @Column({ type: 'enum', enum: FraudRuleType })
  ruleType!: FraudRuleType;

  @Column({ type: 'int', default: 0 })
  scoreWeight!: number;

  @Column({ type: 'jsonb', nullable: true })
  conditions?: Record<string, any>;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
