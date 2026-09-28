import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnboardingChecklist, ChecklistItemStatus } from './entities/onboarding-checklist.entity';
import { UpdateChecklistItemDto } from './dto/checklist-item.dto';
import { ProviderOnboardingStatusDto, ChecklistItemResponseDto } from './dto/provider-onboarding-status.dto';

const DEFAULT_CHECKLIST_ITEMS = [
  { itemKey: 'profile_complete', itemLabel: 'Complete provider profile' },
  { itemKey: 'identity_verified', itemLabel: 'Verify identity documents' },
  { itemKey: 'stake_deposited', itemLabel: 'Deposit required stake' },
  { itemKey: 'agreement_signed', itemLabel: 'Sign provider agreement' },
  { itemKey: 'first_signal_submitted', itemLabel: 'Submit first test signal' },
];

@Injectable()
export class ChecklistService {
  constructor(
    @InjectRepository(OnboardingChecklist)
    private readonly checklistRepo: Repository<OnboardingChecklist>,
  ) {}

  async initializeChecklist(providerId: string): Promise<OnboardingChecklist[]> {
    const existing = await this.checklistRepo.find({ where: { providerId } });
    if (existing.length > 0) return existing;

    const items = DEFAULT_CHECKLIST_ITEMS.map((item) =>
      this.checklistRepo.create({ providerId, ...item }),
    );
    return this.checklistRepo.save(items);
  }

  async getStatus(providerId: string): Promise<ProviderOnboardingStatusDto> {
    const items = await this.checklistRepo.find({ where: { providerId } });
    if (items.length === 0) {
      await this.initializeChecklist(providerId);
      return this.getStatus(providerId);
    }

    const completed = items.filter((i) => i.status === ChecklistItemStatus.COMPLETED);
    return {
      providerId,
      isReady: completed.length === items.length,
      completedCount: completed.length,
      totalCount: items.length,
      items: items.map(this.toResponseDto),
    };
  }

  async updateItem(
    providerId: string,
    itemKey: string,
    dto: UpdateChecklistItemDto,
  ): Promise<ChecklistItemResponseDto> {
    const item = await this.checklistRepo.findOne({ where: { providerId, itemKey } });
    if (!item) throw new NotFoundException(`Checklist item '${itemKey}' not found`);

    item.status = dto.status;
    item.notes = dto.notes;
    if (dto.status === ChecklistItemStatus.COMPLETED) {
      item.completedAt = new Date();
    }

    const saved = await this.checklistRepo.save(item);
    return this.toResponseDto(saved);
  }

  private toResponseDto(item: OnboardingChecklist): ChecklistItemResponseDto {
    return {
      id: item.id,
      itemKey: item.itemKey,
      itemLabel: item.itemLabel,
      status: item.status,
      notes: item.notes,
      completedAt: item.completedAt,
    };
  }
}
