import { ChecklistItemStatus } from '../entities/onboarding-checklist.entity';

export class ChecklistItemResponseDto {
  id!: string;
  itemKey!: string;
  itemLabel!: string;
  status!: ChecklistItemStatus;
  notes?: string;
  completedAt?: Date;
}

export class ProviderOnboardingStatusDto {
  providerId!: string;
  isReady!: boolean;
  completedCount!: number;
  totalCount!: number;
  items!: ChecklistItemResponseDto[];
}
