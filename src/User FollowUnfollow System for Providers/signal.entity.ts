import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('signals')
export class Signal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'provider_id' })
  @Index()
  providerId: string;

  @Column({ type: 'text', nullable: true })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
