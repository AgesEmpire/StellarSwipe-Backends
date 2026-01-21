import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('risk_settings')
export class RiskSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string = '';

  @Column({ type: 'uuid' })
  userId: string = '';

  @Column({ default: 10 })
  maxOpenPositions: number = 10;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 50.0 })
  maxExposurePercentage: number = 50;

  @Column({ default: true })
  requireStopLoss: boolean = true;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 5.0 })
  minStopLossPercentage: number = 5;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 20.0 })
  maxStopLossPercentage: number = 20;

  @CreateDateColumn()
  createdAt: Date = new Date();

  @UpdateDateColumn()
  updatedAt: Date = new Date();
}
