import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum FreezeStatus {
  FROZEN = 'FROZEN',
  UNFROZEN = 'UNFROZEN',
}

export enum FreezeReason {
  SECURITY = 'SECURITY',
  REGULATORY = 'REGULATORY',
  COMPLIANCE = 'COMPLIANCE',
  ADMIN = 'ADMIN',
}

@Entity('asset_freezes')
@Index(['assetId', 'status'])
export class AssetFreeze {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The asset being frozen/unfrozen */
  @Column({ name: 'asset_id' })
  @Index()
  assetId: string;

  @Column({
    type: 'enum',
    enum: FreezeStatus,
    default: FreezeStatus.FROZEN,
  })
  status: FreezeStatus;

  @Column({
    type: 'enum',
    enum: FreezeReason,
    default: FreezeReason.ADMIN,
  })
  reason: FreezeReason;

  /** Human-readable description of why the asset was frozen */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Admin user who initiated the freeze/unfreeze action */
  @Column({ name: 'initiated_by' })
  initiatedBy: string;

  /** Timestamp when the freeze was applied */
  @Column({ name: 'frozen_at', nullable: true })
  frozenAt: Date | null;

  /** Timestamp when the freeze was lifted */
  @Column({ name: 'unfrozen_at', nullable: true })
  unfrozenAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
