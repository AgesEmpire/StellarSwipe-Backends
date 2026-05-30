import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum FraudDecision {
  ALLOW = 'allow',
  REVIEW = 'review',
  BLOCK = 'block',
}

@Entity('fraud_scores')
export class FraudScore {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  transactionId!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'int' })
  totalScore!: number;

  @Column({ type: 'enum', enum: FraudDecision })
  decision!: FraudDecision;

  @Column({ type: 'jsonb', nullable: true })
  breakdown?: Record<string, number>;

  @CreateDateColumn()
  createdAt!: Date;
}
