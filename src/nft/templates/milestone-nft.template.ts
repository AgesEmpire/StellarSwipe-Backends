import { MetadataSchema } from '../interfaces/metadata-schema.interface';

export function buildMilestoneTemplate(params: {
  name: string;
  description: string;
  milestoneValue: number | string;
  milestoneUnit: string;
  rarity: MetadataSchema['rarity'];
  imageUrl: string;
  issuer: string;
}): MetadataSchema {
  return {
    name: params.name,
    description: params.description,
    image: params.imageUrl,
    type: 'milestone',
    rarity: params.rarity,
    issuer: params.issuer,
    issued_at: new Date().toISOString(),
    attributes: [
      { trait_type: 'Milestone', value: params.milestoneValue },
      { trait_type: 'Unit', value: params.milestoneUnit },
      { trait_type: 'Rarity', value: params.rarity },
      { trait_type: 'Category', value: 'Milestone' },
    ],
  };
}
