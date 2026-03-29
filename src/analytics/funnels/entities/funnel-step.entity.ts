import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Funnel } from './funnel.entity';

@Entity('funnel_steps')
@Index(['funnel', 'stepOrder'], { unique: true })
export class FunnelStep {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Funnel, (f) => f.steps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'funnel_id' })
  funnel!: Funnel;

  @Column({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'step_order', type: 'int' })
  stepOrder!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description?: string;
}
