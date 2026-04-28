import { MetadataSchema } from '../interfaces/metadata-schema.interface';

export function buildTrophyTemplate(params: {
  name: string;
  description: string;
  rank: number;
  competitionName: string;
  rarity: MetadataSchema['rarity'];
  imageUrl: string;
  issuer: string;
}): MetadataSchema {
  return {
    name: params.name,
    description: params.description,
    image: params.imageUrl,
    type: 'trophy',
    rarity: params.rarity,
    issuer: params.issuer,
    issued_at: new Date().toISOString(),
    attributes: [
      { trait_type: 'Rank', value: params.rank },
      { trait_type: 'Competition', value: params.competitionName },
      { trait_type: 'Rarity', value: params.rarity },
      { trait_type: 'Category', value: 'Trophy' },
    ],
  };
}
