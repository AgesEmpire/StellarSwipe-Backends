import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('dex_routes')
@Index(['sourceAssetCode', 'destinationAssetCode', 'dexId'])
@Index(['createdAt'])
export class DexRouteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dex_id', length: 50 })
  dexId: string;

  @Column({ name: 'dex_name', length: 100 })
  dexName: string;

  @Column({ name: 'source_asset_code', length: 12 })
  sourceAssetCode: string;

  @Column({ name: 'source_asset_issuer', length: 60, nullable: true })
  sourceAssetIssuer: string;

  @Column({ name: 'destination_asset_code', length: 12 })
  destinationAssetCode: string;

  @Column({ name: 'destination_asset_issuer', length: 60, nullable: true })
  destinationAssetIssuer: string;

  @Column({ name: 'source_amount', type: 'decimal', precision: 20, scale: 7 })
  sourceAmount: number;

  @Column({
    name: 'destination_amount',
    type: 'decimal',
    precision: 20,
    scale: 7,
  })
  destinationAmount: number;

  @Column({ name: 'price', type: 'decimal', precision: 20, scale: 7 })
  price: number;

  @Column({ name: 'fee', type: 'decimal', precision: 10, scale: 6 })
  fee: number;

  @Column({ name: 'path', type: 'jsonb', nullable: true })
  path: object[];

  @Column({
    name: 'estimated_slippage',
    type: 'decimal',
    precision: 10,
    scale: 4,
  })
  estimatedSlippage: number;

  @Column({ name: 'confidence', type: 'decimal', precision: 5, scale: 4 })
  confidence: number;

  @Column({ name: 'is_optimal', type: 'boolean', default: false })
  isOptimal: boolean;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
