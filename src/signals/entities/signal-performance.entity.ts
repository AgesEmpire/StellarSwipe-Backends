import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
 feat/signal-performance
  Index,
} from 'typeorm';
import { Signal } from './signal.entity';

@Entity('signal_performance')

} from 'typeorm';
import { Signal } from './signal.entity';

@Entity('signal_performances')
 main
export class SignalPerformance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

 feat/signal-performance
  @Column({ name: 'signal_id', type: 'uuid' })
  @Index()
  signalId!: string;

  @ManyToOne(() => Signal, (signal) => signal.performanceHistory)
  @JoinColumn({ name: 'signal_id' })
  signal!: Signal;

  @Column({ name: 'price_at_check', type: 'decimal', precision: 18, scale: 8 })
  priceAtCheck!: string;

  @Column({ name: 'pnl_percentage', type: 'decimal', precision: 10, scale: 4 })
  pnlPercentage!: string;

  @Column({ name: 'pnl_absolute', type: 'decimal', precision: 18, scale: 8 })
  pnlAbsolute!: string;

  @Column({ name: 'distance_to_target', type: 'decimal', precision: 10, scale: 4 })
  distanceToTarget!: string;

  @Column({ name: 'distance_to_stop_loss', type: 'decimal', precision: 10, scale: 4 })
  distanceToStopLoss!: string;

  @Column({ name: 'max_drawdown', type: 'decimal', precision: 10, scale: 4, default: '0' })
  maxDrawdown!: string;

  @Column({ name: 'max_profit', type: 'decimal', precision: 10, scale: 4, default: '0' })
  maxProfit!: string;

  @Column({ name: 'time_elapsed_seconds', type: 'int' })
  timeElapsedSeconds!: number;

  @Column({ name: 'copiers_at_check', default: 0 })
  copiersAtCheck!: number;

  @Column({ name: 'volume_at_check', type: 'decimal', precision: 18, scale: 8, default: '0' })
  volumeAtCheck!: string;

  @Column({ name: 'price_source', length: 50, default: 'sdex' })
  priceSource!: string;

  @Column({ name: 'is_price_available', default: true })
  isPriceAvailable!: boolean;

  @CreateDateColumn({ name: 'checked_at' })
  checkedAt!: Date;

  @Column()
  signal_id!: string;

  @ManyToOne(() => Signal)
  @JoinColumn({ name: 'signal_id' })
  signal!: Signal;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  price_at_timestamp!: number;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  unrealized_pnl!: number;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  current_roi!: number;

  @CreateDateColumn()
  timestamp!: Date;
 main
}
