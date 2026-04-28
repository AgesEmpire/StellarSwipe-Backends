import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Competition } from './competition.entity';
import { CompetitionTrade } from './competition-trade.entity';

export enum ParticipantStatus {
  ACTIVE = 'ACTIVE',
  DISQUALIFIED = 'DISQUALIFIED',
}

@Entity('competition_participants')
@Index(['competition', 'user'], { unique: true })
@Index(['competition', 'rank'])
export class Participant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Competition, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'competition_id' })
  competition!: Competition;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'joined_at', type: 'timestamp with time zone' })
  joinedAt!: Date;

  @Column({ name: 'current_score', type: 'double precision', default: 0 })
  currentScore!: number;

  @Column({ type: 'int', nullable: true })
  rank!: number | null;

  @Column({
    type: 'varchar',
    length: 32,
    default: ParticipantStatus.ACTIVE,
  })
  status!: ParticipantStatus;

  @OneToMany(() => CompetitionTrade, (t) => t.participant)
  trades!: CompetitionTrade[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
