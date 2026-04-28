import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('retention_campaigns')
export class RetentionCampaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  churnPredictionId: string;

  @Column({ type: 'varchar' })
  actionType: string;

  @Column({ type: 'text', nullable: true })
  message: string;

  @Column({ default: false })
  opened: boolean;

  @Column({ default: false })
  converted: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
