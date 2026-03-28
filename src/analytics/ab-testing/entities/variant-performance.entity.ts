import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('variant_performance')
@Index(['experimentId', 'variantId'])
export class VariantPerformance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'experiment_id' })
  experimentId!: string;

  @Column({ name: 'variant_id' })
  variantId!: string;

  @Column()
  name!: string;

  @Column({ type: 'int', default: 0 })
  impressions!: number;

  @Column({ type: 'int', default: 0 })
  conversions!: number;

  @Column({ name: 'conversion_rate', type: 'float', default: 0 })
  conversionRate!: number;

  @Column({ type: 'float', nullable: true })
  mean!: number | null;

  @Column({ name: 'std_dev', type: 'float', nullable: true })
  stdDev!: number | null;

  @CreateDateColumn({ name: 'recorded_at' })
  recordedAt!: Date;
}
