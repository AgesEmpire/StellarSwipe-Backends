import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

@Entity('churn_predictions')
@Index(['userId', 'createdAt'])
export class ChurnPrediction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'decimal', precision: 5, scale: 4 })
  riskScore: number;

  @Column({ type: 'varchar' })
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  @Column({ type: 'int', nullable: true })
  daysSinceLastLogin: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  engagementScore: number;

  @Column({ default: false })
  retentionTriggered: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
