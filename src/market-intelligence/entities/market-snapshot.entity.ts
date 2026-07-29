import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * #533 — Market Snapshot Entity
 *
 * Stores periodic snapshots of market data including prices,
 * liquidity, and order book information for Stellar asset pairs.
 * This data is used by trading engines, feeds, and analytics systems.
 */
@Entity('market_snapshots')
@Index(['baseAsset', 'counterAsset', 'capturedAt'], { name: 'idx_market_pair_time' })
@Index(['capturedAt'], { name: 'idx_market_time' })
export class MarketSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 50 })
  assetPair: string;

  @Column('varchar', { length: 50 })
  baseAsset: string;

  @Column('varchar', { length: 50 })
  counterAsset: string;

  /**
   * Current market price of the asset pair.
   * Stored as string for precision with Stellar assets (8 decimal places).
   */
  @Column('decimal', { precision: 20, scale: 8 })
  price: string;

  /**
   * Total liquidity available in the market for this pair.
   * Represents the aggregate available volume on order books.
   */
  @Column('decimal', { precision: 20, scale: 2 })
  liquidity: string;

  /**
   * 24-hour trading volume for this asset pair.
   */
  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  volume24h: string;

  /**
   * Order book snapshot including bid and ask levels.
   * Stored as JSON for flexibility in book structure.
   */
  @Column('jsonb', { nullable: true })
  orderBookSnapshot?: {
    bids: Array<{ price: number; quantity: number; totalValue: number }>;
    asks: Array<{ price: number; quantity: number; totalValue: number }>;
  };

  /**
   * Source of this market data (SDEX, CoinGecko, etc).
   */
  @Column('varchar', { length: 50, nullable: true })
  source?: string;

  /**
   * Timestamp when this snapshot was captured.
   */
  @Column('timestamp')
  capturedAt: Date;

  /**
   * Additional metadata for this snapshot.
   */
  @Column('jsonb', { nullable: true })
  metadata?: {
    bidAskSpread?: number;
    highPrice24h?: string;
    lowPrice24h?: string;
    priceChangePercent24h?: number;
    marketCap?: string;
    dominance?: number;
  };

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
