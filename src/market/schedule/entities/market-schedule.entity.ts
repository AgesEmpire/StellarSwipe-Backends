import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum DayOfWeek {
  MONDAY = 'monday',
  TUESDAY = 'tuesday',
  WEDNESDAY = 'wednesday',
  THURSDAY = 'thursday',
  FRIDAY = 'friday',
  SATURDAY = 'saturday',
  SUNDAY = 'sunday',
}

@Entity('market_schedules')
export class MarketSchedule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 50 })
  region!: string;

  @Column({ length: 20 })
  assetClass!: string;

  @Column({ type: 'enum', enum: DayOfWeek })
  dayOfWeek!: DayOfWeek;

  @Column({ length: 5 })
  openTime!: string;

  @Column({ length: 5 })
  closeTime!: string;

  @Column({ type: 'varchar', length: 50, default: 'UTC' })
  timezone!: string;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
