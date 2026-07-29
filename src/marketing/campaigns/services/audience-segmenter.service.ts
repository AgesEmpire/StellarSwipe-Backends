import { Injectable } from '@nestjs/common';
import { Campaign } from '../entities/campaign.entity';
import { TargetingEngine, TargetingContext } from '../utils/targeting-engine';

export interface AudienceSegment {
  segmentId: string;
  name: string;
  size: number;
  criteria: Record<string, unknown>;
}

@Injectable()
export class AudienceSegmenterService {
  constructor(private targetingEngine: TargetingEngine) {}

  segmentUsersForCampaign(
    campaign: Campaign,
    users: TargetingContext[],
  ): { targeted: TargetingContext[]; excluded: TargetingContext[] } {
    const targeted: TargetingContext[] = [];
    const excluded: TargetingContext[] = [];

    for (const user of users) {
      if (this.targetingEngine.isUserTargeted(campaign, user)) {
        targeted.push(user);
      } else {
        excluded.push(user);
      }
    }

    return { targeted, excluded };
  }

  estimateAudienceSize(campaign: Campaign, totalUsers: number): number {
    if (!campaign.targets || campaign.targets.length === 0) return totalUsers;
    // Simplified estimation: each target narrows the audience by ~10%
    const reductionFactor = Math.pow(0.9, campaign.targets.length);
    return Math.floor(totalUsers * reductionFactor);
  }

  buildSegmentCriteria(campaign: Campaign): Record<string, unknown> {
    const criteria: Record<string, unknown> = { region: campaign.region };
    for (const target of campaign.targets ?? []) {
      criteria[target.targetType] = target.targetValue;
    }
    return criteria;
  }
}
