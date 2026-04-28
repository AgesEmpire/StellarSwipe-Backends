import { MetadataSchema } from '../interfaces/metadata-schema.interface';

export function buildAchievementTemplate(params: {
  name: string;
  description: string;
  achievementKey: string;
  rarity: MetadataSchema['rarity'];
  imageUrl: string;
  issuer: string;
}): Omit<MetadataSchema, 'image'> & { image: string } {
  return {
    name: params.name,
    description: params.description,
    image: params.imageUrl,
    type: 'achievement',
    rarity: params.rarity,
    issuer: params.issuer,
    issued_at: new Date().toISOString(),
    attributes: [
      { trait_type: 'Achievement', value: params.achievementKey },
      { trait_type: 'Rarity', value: params.rarity },
      { trait_type: 'Category', value: 'Achievement' },
    ],
  };
}
