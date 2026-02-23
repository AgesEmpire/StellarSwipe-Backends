import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

@Entity('orders')
@Index(['positionId', 'exitOrder'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  positionId: string;

  @Column()
  userId: string;

  @Column()
  symbol: string;

  @Column({ type: 'enum', enum: OrderType })
  type: OrderType;

  @Column({ type: 'enum', enum: OrderSide })
  side: OrderSide;

  @Column('decimal', { precision: 18, scale: 8 })
  quantity: number;

  @Column({ default: false })
  exitOrder: boolean;

  @Column('decimal', { precision: 18, scale: 8, nullable: true })
  requestedPrice: number | null;

  @Column('decimal', { precision: 18, scale: 8, nullable: true })
  filledPrice: number | null;

  @Column({ default: 'PENDING' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;
}
