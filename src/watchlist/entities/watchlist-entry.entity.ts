import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';

@Entity('watchlist_entries')
@Unique(['userId', 'traderId'])
export class WatchlistEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Index()
  @Column({ name: 'trader_id', type: 'uuid' })
  traderId!: string;

  @CreateDateColumn({ name: 'added_at', type: 'timestamp with time zone' })
  addedAt!: Date;
}
