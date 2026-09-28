import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChecklistService } from './checklist.service';
import { OnboardingChecklist } from './entities/onboarding-checklist.entity';

@Module({
  imports: [TypeOrmModule.forFeature([OnboardingChecklist])],
  providers: [ChecklistService],
  exports: [ChecklistService],
})
export class ProviderOnboardingChecklistModule {}
