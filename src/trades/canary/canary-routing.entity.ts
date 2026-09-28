import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Configuration for canary routing of trade traffic.
 * Controls what percentage of trades are routed to the canary contract version.
 */
@Index('idx_canary_routing_active', ['isActive'])
@Entity('canary_routing_config')
export class CanaryRoutingConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  currentContractId!: string;

  @Column({ type: 'varchar', length: 128 })
  canaryContractId!: string;

  @Column({
    type: 'int',
    comment: 'Percentage of traffic to route to canary (0-100)',
  })
  canaryPercentage!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
