import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Index } from 'typeorm';

@Entity('currency_preferences')
@Index(['userId'], { unique: true })
export class CurrencyPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ length: 10, default: 'USD' })
  preferredCurrency: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
