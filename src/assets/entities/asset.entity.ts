import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { AssetPair } from './asset-pair.entity';

export enum AssetType {
  NATIVE = 'NATIVE', // XLM
  ISSUED = 'ISSUED',
  CUSTOM = 'CUSTOM',
}

@Entity('assets')
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 12 })
  code!: string;

  @Column({ length: 56, nullable: true })
  issuer?: string | null;

  @Column({
    type: 'enum',
    enum: AssetType,
    default: AssetType.ISSUED,
  })
  type!: AssetType;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description!: string | null;

  @Column({ type: 'text', nullable: true })
  logoUrl!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'boolean', default: false })
  isVerified!: boolean;

  @Column({ type: 'boolean', default: false })
  isPopular!: boolean;

  @Column({ type: 'int', default: 0 })
  popularity!: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => AssetPair, (pair) => pair.baseAsset)
  basePairs!: AssetPair[];

  @OneToMany(() => AssetPair, (pair) => pair.counterAsset)
  counterPairs!: AssetPair[];

  /**
   * Get the full asset format: CODE:ISSUER or just CODE for native
   */
  getAssetFormat(): string {
    if (this.type === AssetType.NATIVE) {
      return this.code;
    }
    return `${this.code}:${this.issuer}`;
  }
}
