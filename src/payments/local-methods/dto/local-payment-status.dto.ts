import { LocalPaymentStatus } from '../providers/base-local.provider';

export class LocalPaymentStatusDto {
  transactionId!: string;
  provider!: string;
  status!: LocalPaymentStatus;
  amount!: number;
  currency!: string;
  country!: string;
  completedAt?: Date;
  metadata?: Record<string, any>;
}
