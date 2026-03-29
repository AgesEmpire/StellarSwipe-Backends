import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Funnel } from './funnel.entity';

@Entity('funnel_steps')
@Index(['funnelId', 'stepKey'])
export class FunnelStep {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'funnel_id', type: 'uuid' })
  funnelId!: string;

  @ManyToOne(() => Funnel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'funnel_id' })
  funnel!: Funnel;

  @Column({ name: 'step_key', type: 'varchar', length: 100 })
  stepKey!: string;

  @Column({ name: 'step_name', type: 'varchar', length: 100 })
  stepName!: string;

  @Column({ name: 'step_order', type: 'int' })
  stepOrder!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
