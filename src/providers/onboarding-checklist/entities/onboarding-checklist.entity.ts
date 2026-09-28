import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum ChecklistItemStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  SKIPPED = 'skipped',
}

@Entity('provider_onboarding_checklist')
export class OnboardingChecklist {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  providerId!: string;

  @Column({ length: 100 })
  itemKey!: string;

  @Column({ length: 200 })
  itemLabel!: string;

  @Column({ type: 'enum', enum: ChecklistItemStatus, default: ChecklistItemStatus.PENDING })
  status!: ChecklistItemStatus;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
