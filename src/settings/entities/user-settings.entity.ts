import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  Index,
} from 'typeorm';

export interface TradingSettings {
  defaultOrderType: 'market' | 'limit';
  defaultSlippage: number;
  confirmTrades: boolean;
}

export interface RiskSettings {
  maxOpenPositions: number;
  maxExposure: number;
  requireStopLoss: boolean;
}

export interface DisplaySettings {
  theme: 'light' | 'dark';
  language: string;
  currency: string;
}

export interface NotificationSettings {
  email: boolean;
  push: boolean;
  tradeFills: boolean;
  priceAlerts: boolean;
  systemUpdates: boolean;
}

export interface UserSettingsData {
  trading: TradingSettings;
  risk: RiskSettings;
  display: DisplaySettings;
  notifications: NotificationSettings;
}

@Entity('user_settings')
export class UserSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { unique: true })
  userId: string;

  @Column('jsonb')
  settings: UserSettingsData;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Optimistic concurrency token — bumped on every update. */
  @VersionColumn()
  version: number;
}
