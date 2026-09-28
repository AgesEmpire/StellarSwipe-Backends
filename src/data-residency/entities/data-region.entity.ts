import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';

export enum RegionCode {
  EU = 'EU',
  US = 'US',
  ASIA = 'ASIA',
  APAC = 'APAC',
  LATAM = 'LATAM',
}

export enum RegionStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  MAINTENANCE = 'maintenance',
}

@Entity('data_regions')
export class DataRegion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10, unique: true })
  code: RegionCode;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 500 })
  storageEndpoint: string;

  @Column({ type: 'simple-array' })
  countryCodes: string[];

  @Column({ type: 'varchar', length: 20, default: RegionStatus.ACTIVE })
  status: RegionStatus;

  @Column({ type: 'jsonb', nullable: true })
  complianceFrameworks: string[];

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
