import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('user_provider_mutes')
@Unique('uq_user_provider_mute', ['userId', 'providerId'])
export class UserProviderMute {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  providerId!: string;

  @CreateDateColumn({ name: 'muted_at' })
  mutedAt!: Date;
}
