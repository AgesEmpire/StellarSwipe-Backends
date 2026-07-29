import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

export enum OnChainEventType {
  TRADE_EXECUTED = 'TRADE_EXECUTED',
  STAKE_CHANGED = 'STAKE_CHANGED',
  CONTRACT_RESULT = 'CONTRACT_RESULT',
}

@Unique('uq_on_chain_events_dedup', ['txHash', 'eventIndex'])
@Index('idx_on_chain_events_type_ledger', ['eventType', 'ledger'])
@Index('idx_on_chain_events_contract', ['contractId'])
@Entity('on_chain_events')
export class OnChainEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tx_hash', length: 128 })
  txHash!: string;

  /** Position of this event within the transaction — used for dedup */
  @Column({ name: 'event_index', type: 'integer', default: 0 })
  eventIndex!: number;

  @Column({ name: 'ledger', type: 'integer' })
  ledger!: number;

  @Column({ name: 'event_type', type: 'enum', enum: OnChainEventType })
  eventType!: OnChainEventType;

  @Column({ name: 'contract_id', length: 128, nullable: true })
  contractId?: string;

  /** Raw decoded event payload */
  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'ledger_close_time', type: 'timestamp', nullable: true })
  ledgerCloseTime?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
