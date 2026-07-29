import { IsString, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { ChecklistItemStatus } from '../entities/onboarding-checklist.entity';

export class UpdateChecklistItemDto {
  @IsEnum(ChecklistItemStatus)
  status!: ChecklistItemStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
