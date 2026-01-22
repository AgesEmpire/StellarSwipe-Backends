import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Signal } from './signal.entity';

export enum InteractionType {
  VIEW = 'VIEW',
  COPY = 'COPY',
  FOLLOW = 'FOLLOW',
  LIKE = 'LIKE',
}

@Entity('signal_interactions')
export class SignalInteraction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  user_id!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column()
  signal_id!: string;

  @ManyToOne(() => Signal)
  @JoinColumn({ name: 'signal_id' })
  signal!: Signal;

  @Column({
    type: 'enum',
    enum: InteractionType,
  })
  type!: InteractionType;

  @CreateDateColumn()
  created_at!: Date;
}
