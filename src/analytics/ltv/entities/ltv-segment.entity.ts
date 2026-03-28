import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('ltv_segments')
export class LtvSegment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  segment!: string;

  @Column({ name: 'min_ltv', type: 'float', default: 0 })
  minLtv!: number;

  @Column({ name: 'max_ltv', type: 'float', default: 0 })
  maxLtv!: number;

  @Column({ name: 'user_count', type: 'int', default: 0 })
  userCount!: number;

  @Column({ name: 'avg_ltv', type: 'float', default: 0 })
  avgLtv!: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
