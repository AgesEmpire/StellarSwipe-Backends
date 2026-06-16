import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('api_keys')
@Index(['userId', 'tenantId'])
@Index(['tenantId'])
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid', nullable: true })
  tenantId?: string; // Multi-tenant support

  @Column({ length: 100 })
  name!: string;

  @Column({ length: 60 })
  keyHash!: string;

  @Column('simple-array')
  scopes!: string[]; // e.g., ['tenant:123:read_trades', 'tenant:123:write_signals']

  @Column({ type: 'timestamp', nullable: true })
  lastUsed?: Date;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'int', default: 1000 })
  rateLimit!: number;

  @Column({ type: 'boolean', default: false })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;
}

