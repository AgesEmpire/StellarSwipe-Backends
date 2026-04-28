import { Injectable } from '@nestjs/common';
import { MetadataSchema, NftType, NftRarity } from '../interfaces/metadata-schema.interface';
import { buildAchievementTemplate } from '../templates/achievement-nft.template';
import { buildTrophyTemplate } from '../templates/trophy-nft.template';
import { buildMilestoneTemplate } from '../templates/milestone-nft.template';

const DEFAULT_IMAGE_BASE = process.env.NFT_IMAGE_BASE_URL || 'https://assets.stellarswipe.io/nft';

@Injectable()
export class MetadataGenerator {
  generate(params: {
    type: NftType;
    name: string;
    description: string;
    rarity: NftRarity;
    issuer: string;
    extra?: Record<string, unknown>;
  }): MetadataSchema {
    const imageUrl = `${DEFAULT_IMAGE_BASE}/${params.type}/${params.rarity}.png`;
    const base = { ...params, imageUrl };

    switch (params.type) {
      case 'achievement':
        return buildAchievementTemplate({
          ...base,
          achievementKey: (params.extra?.achievementKey as string) ?? params.name,
        });
      case 'trophy':
        return buildTrophyTemplate({
          ...base,
          rank: (params.extra?.rank as number) ?? 1,
          competitionName: (params.extra?.competitionName as string) ?? 'StellarSwipe',
        });
      case 'milestone':
        return buildMilestoneTemplate({
          ...base,
          milestoneValue: (params.extra?.milestoneValue as number) ?? 0,
          milestoneUnit: (params.extra?.milestoneUnit as string) ?? 'trades',
        });
    }
  }
}
