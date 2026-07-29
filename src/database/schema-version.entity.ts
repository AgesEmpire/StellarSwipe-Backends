import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('schema_versions')
@Index(['entityName', 'version'], { unique: true })
export class SchemaVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'entity_name', length: 255 })
  entityName: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_compatible', type: 'boolean', default: true })
  isCompatible: boolean;

  @Column({ name: 'migration_name', length: 255, nullable: true })
  migrationName: string | null;

  @CreateDateColumn({ name: 'applied_at', type: 'timestamp with time zone' })
  appliedAt: Date;
}
