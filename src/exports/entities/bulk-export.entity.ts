import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ExportStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum ExportFormat {
  CSV = 'csv',
  JSON = 'json',
}

export enum ExportType {
  TRANSACTIONS = 'transactions',
  CONTEST_RESULTS = 'contest_results',
  SIGNALS = 'signals',
  PORTFOLIO = 'portfolio',
  TAX_REPORT = 'tax_report',
}

@Entity('bulk_exports')
export class BulkExport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'enum', enum: ExportType })
  type!: ExportType;

  @Column({ type: 'enum', enum: ExportFormat, default: ExportFormat.CSV })
  format!: ExportFormat;

  @Column({ type: 'enum', enum: ExportStatus, default: ExportStatus.PENDING })
  status!: ExportStatus;

  @Column({ type: 'jsonb', nullable: true })
  filters?: Record<string, unknown>;

  @Column({ nullable: true })
  downloadUrl?: string;

  @Column({ type: 'timestamp', nullable: true })
  urlExpiresAt?: Date;

  @Column({ nullable: true })
  errorMessage?: string;

  @Column({ type: 'int', nullable: true })
  rowCount?: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
