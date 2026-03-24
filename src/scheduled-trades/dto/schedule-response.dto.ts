import { ScheduleType, ScheduleStatus, ScheduleConditions } from '../entities/scheduled-trade.entity';

export class ScheduleResponseDto {
  id!: string;
  userId!: string;
  signalId?: string;
  assetPair!: string;
  scheduleType!: ScheduleType;
  conditions!: ScheduleConditions;
  amount!: number;
  status!: ScheduleStatus;
  expiresAt?: Date;
  retryCount!: number;
  lastError?: string;
  executedAt?: Date;
  createdAt!: Date;
}
