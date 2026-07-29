import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RiskThresholdType {
  ORDER_SIZE = 'order_size',
  LEVERAGE = 'leverage',
  ASSET_EXPOSURE = 'asset_exposure',
}

@Entity('risk_thresholds')
export class RiskThreshold {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: RiskThresholdType, unique: true })
  type!: RiskThresholdType;

  @Column({ type: 'decimal', precision: 18, scale: 6 })
  value!: string;

  @Column({ name: 'updated_by', nullable: true })
  updatedBy?: string;

  @Column({ nullable: true })
  description?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
