import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('price_history')
@Index(['assetPair', 'timestamp'])
export class PriceHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  assetPair: string;

  @Column('decimal', { precision: 18, scale: 8 })
  price: number;

  @Column()
  source: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: {
    sdexPrice?: number;
    coingeckoPrice?: number;
    stellarExpertPrice?: number;
    pricesUsed: number[];
    deviation?: number;
  };

  @Column({ type: 'timestamp' })
  @Index()
  timestamp: Date;

  @CreateDateColumn()
  createdAt: Date;
}
