import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Participant } from './participant.entity';

@Entity('competition_trades')
@Index(['participant', 'recordedAt'])
export class CompetitionTrade {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Participant, (p) => p.trades, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'participant_id' })
  participant!: Participant;

  @Column({ name: 'external_trade_id', type: 'varchar', length: 128, nullable: true })
  externalTradeId?: string | null;

  @Column({ type: 'decimal', precision: 24, scale: 8, default: '0' })
  volume!: string;

  @Column({ name: 'realized_pnl', type: 'decimal', precision: 24, scale: 8, default: '0' })
  realizedPnl!: string;

  @Column({ name: 'asset_pair', type: 'varchar', length: 64, nullable: true })
  assetPair?: string | null;

  @Column({ name: 'recorded_at', type: 'timestamp with time zone' })
  recordedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;
}
