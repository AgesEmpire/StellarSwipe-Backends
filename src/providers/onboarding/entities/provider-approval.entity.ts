import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('provider_approvals')
export class ProviderApproval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'application_id' })
  @Index()
  applicationId: string;

  @Column({ type: 'enum', enum: ['approve', 'reject'] })
  action: 'approve' | 'reject';

  @Column({ name: 'admin_id' })
  adminId: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
