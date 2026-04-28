import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { FunnelStep } from './funnel-step.entity';
import { UserFunnelProgress } from './user-funnel-progress.entity';

@Entity('funnels')
export class Funnel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name!: string;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive!: boolean;

  @OneToMany(() => FunnelStep, (step) => step.funnel, { cascade: true, eager: true })
  steps!: FunnelStep[];

  @OneToMany(() => UserFunnelProgress, (p) => p.funnel)
  progress!: UserFunnelProgress[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
