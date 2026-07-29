import { Injectable } from '@nestjs/common';
import { Campaign } from '../entities/campaign.entity';
import { CampaignTarget, TargetType } from '../entities/campaign-target.entity';

export interface TargetingContext {
  userId?: string;
  region?: string;
  country?: string;
  language?: string;
  userTier?: string;
  userSegments?: string[];
}

@Injectable()
export class TargetingEngine {
  isUserTargeted(campaign: Campaign, context: TargetingContext): boolean {
    if (!campaign.targets || campaign.targets.length === 0) return true;
    return campaign.targets.every((target) => this.evaluateTarget(target, context));
  }

  private evaluateTarget(target: CampaignTarget, context: TargetingContext): boolean {
    switch (target.targetType) {
      case TargetType.COUNTRY:
        return context.country?.toUpperCase() === target.targetValue.toUpperCase();
      case TargetType.REGION:
        return context.region?.toUpperCase() === target.targetValue.toUpperCase();
      case TargetType.LANGUAGE:
        return context.language?.toLowerCase().startsWith(target.targetValue.toLowerCase());
      case TargetType.USER_TIER:
        return context.userTier === target.targetValue;
      case TargetType.USER_SEGMENT:
        return context.userSegments?.includes(target.targetValue) ?? false;
      default:
        return true;
    }
  }

  filterCampaignsForUser(campaigns: Campaign[], context: TargetingContext): Campaign[] {
    return campaigns.filter((c) => this.isUserTargeted(c, context));
  }

  scoreAudience(campaign: Campaign, context: TargetingContext): number {
    if (!campaign.targets || campaign.targets.length === 0) return 1;
    const matchedTargets = campaign.targets.filter((t) => this.evaluateTarget(t, context));
    if (matchedTargets.length === 0) return 0;
    const totalWeight = campaign.targets.reduce((sum, t) => sum + Number(t.weight), 0);
    const matchedWeight = matchedTargets.reduce((sum, t) => sum + Number(t.weight), 0);
    return totalWeight > 0 ? matchedWeight / totalWeight : 0;
  }
}
