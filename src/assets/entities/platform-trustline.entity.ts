import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Asset } from './asset.entity';

export enum TrustlineStatus {
  ACTIVE = 'active',
  ORPHANED = 'orphaned',
}

@Entity('platform_trustlines')
@Index(['platformAccount', 'assetId'], { unique: true })
export class PlatformTrustline {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 56 })
  platformAccount!: string;

  @Index()
  @Column({ type: 'uuid' })
  assetId!: string;

  @ManyToOne(() => Asset, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assetId' })
  asset!: Asset;

  @Column({
    type: 'enum',
    enum: TrustlineStatus,
    default: TrustlineStatus.ACTIVE,
  })
  status!: TrustlineStatus;

  @Column({ type: 'timestamp', nullable: true })
  flaggedAt?: Date;

  @CreateDateColumn()
  establishedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
