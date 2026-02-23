import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('flag_assignments')
@Index(['userId', 'flagName'], { unique: true })
export class FlagAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index('idx_flag_assignment_user')
  userId!: string;

  @Column()
  @Index('idx_flag_assignment_flag')
  flagName!: string;

  @Column({ default: false })
  enabled!: boolean;

  @Column({ nullable: true })
  variant?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
