import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export interface ContractAbiMetadata {
  address?: string;
  compilerVersion?: string;
  deployedBlock?: number;
  sourceCodeHash?: string;
  notes?: string;
}

@Entity('contract_abis')
@Index(['contractName', 'network', 'version'], { unique: true })
export class ContractAbi {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  contractName!: string;

  @Index()
  @Column({ type: 'varchar', length: 80 })
  network!: string;

  @Column({ type: 'varchar', length: 32 })
  version!: string;

  @Column({ type: 'jsonb' })
  abi!: Record<string, unknown>[];

  @Column({ type: 'varchar', length: 128 })
  abiHash!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: ContractAbiMetadata;

  @Column({ type: 'uuid', nullable: true })
  uploadedByUserId?: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
