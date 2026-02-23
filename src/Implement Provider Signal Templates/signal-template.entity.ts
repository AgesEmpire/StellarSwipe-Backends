import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export interface TemplateStructure {
  rationaleTemplate: string;
  stopLossFormula: string;
  takeProfitFormula: string;
  direction?: string; // 'LONG' | 'SHORT' | '{{direction}}'
  timeframe?: string;
  additionalNotes?: string;
}

@Entity('signal_templates')
@Index(['providerId'])
@Index(['isPublic'])
export class SignalTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  providerId: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'jsonb' })
  structure: TemplateStructure;

  @Column({ type: 'simple-array' })
  variables: string[];

  @Column({ type: 'int', default: 0 })
  usageCount: number;

  @Column({ type: 'boolean', default: false })
  isPublic: boolean;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'uuid', nullable: true })
  previousVersionId: string | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
