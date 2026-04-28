import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('exchange_rates')
@Index(['baseCurrency', 'quoteCurrency', 'provider'])
export class ExchangeRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 10 })
  baseCurrency: string;

  @Column({ length: 10 })
  quoteCurrency: string;

  @Column({ type: 'decimal', precision: 24, scale: 10 })
  rate: number;

  @Column({ length: 50 })
  provider: string;

  @CreateDateColumn()
  fetchedAt: Date;
}
