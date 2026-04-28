import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('peer_groups')
@Index(['groupKey'], { unique: true })
export class PeerGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'group_key' })
  groupKey: string;

  @Column({ name: 'name' })
  name: string;

  @Column({ name: 'description', nullable: true })
  description: string | null;

  @Column({ name: 'criteria', type: 'jsonb' })
  criteria: Record<string, any>;

  @Column({ name: 'provider_ids', type: 'jsonb' })
  providerIds: string[];

  @Column({ name: 'provider_count', type: 'int', default: 0 })
  providerCount: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'last_updated_at', type: 'timestamptz' })
  lastUpdatedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
