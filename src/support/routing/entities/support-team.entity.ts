import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('support_teams')
@Index(['region'])
@Index(['isActive'])
export class SupportTeam {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 10 })
  region!: string;

  @Column({ type: 'simple-array' })
  languages!: string[];

  @Column({ type: 'varchar', length: 50 })
  timezone!: string;

  @Column({ type: 'simple-array', nullable: true })
  skills!: string[];

  @Column({ type: 'integer', default: 20 })
  maxCapacity!: number;

  @Column({ type: 'integer', default: 0 })
  currentLoad!: number;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', default: '{}' })
  workingHours!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
